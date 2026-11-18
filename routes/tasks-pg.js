const express = require('express');
const { query, pool } = require('../db/pg-db');
const { authenticate, authorizeRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const router = express.Router();

const STATUSES = ['new', 'in_progress', 'done'];

const TASK_SELECT =
  'SELECT t.*, cu.username AS creator_username, ' +
  '(SELECT COALESCE(json_agg(json_build_object(\'id\', u.id, \'username\', u.username) ORDER BY u.username), \'[]\'::json) ' +
  'FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignees, ' +
  '(SELECT string_agg(u.username, \', \' ORDER BY u.username) ' +
  'FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignee_username, ' +
  '(SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id ORDER BY ta.user_id LIMIT 1) AS assignee_id ' +
  'FROM tasks t LEFT JOIN users cu ON cu.id = t.creator_id';

async function fetchTask(taskId) {
  const r = await query(TASK_SELECT + ' WHERE t.id = $1', [taskId]);
  return r.rows[0] || null;
}

function cleanIds(raw) {
  if (!Array.isArray(raw)) return [];
  const nums = raw.map(function (x) { return parseInt(x, 10); }).filter(function (n) { return Number.isInteger(n) && n > 0; });
  return Array.from(new Set(nums));
}

async function assigneesExist(ids) {
  if (ids.length === 0) return true;
  const r = await query('SELECT id FROM users WHERE id = ANY($1::int[])', [ids]);
  return r.rows.length === ids.length;
}

async function safeAudit(userId, action, entity, entityId, detail) {
  try {
    await logAudit(userId, action, entity, entityId, detail);
  } catch (e) {
    console.error('Audit failed:', e.message);
  }
}

router.get('/', authenticate, async function (req, res) {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    let sql;
    let params;
    if (isAdmin) {
      sql = TASK_SELECT + ' WHERE t.deleted = FALSE ORDER BY t.created_at DESC';
      params = [];
    } else {
      sql = TASK_SELECT + ' WHERE t.deleted = FALSE AND EXISTS(SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1) ORDER BY t.created_at DESC';
      params = [userId];
    }
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/archive', authenticate, authorizeRole(['admin']), async function (req, res) {
  try {
    const result = await query(TASK_SELECT + ' WHERE t.deleted = TRUE ORDER BY t.created_at DESC', []);
    res.json(result.rows);
  } catch (err) {
    console.error('Get archive error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, authorizeRole(['admin']), async function (req, res) {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description : '';
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'new';
  const ids = cleanIds(req.body.assignee_ids);
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (!(await assigneesExist(ids))) return res.status(400).json({ error: 'Unknown assignee id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(
      'INSERT INTO tasks (title, description, status, creator_id, deleted) VALUES ($1, $2, $3, $4, FALSE) RETURNING id',
      [title, description, status, req.user.id]
    );
    const taskId = taskRes.rows[0].id;
    for (const uid of ids) {
      await client.query(
        'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1, $2, $3)',
        [taskId, uid, req.user.id]
      );
    }
    await client.query('COMMIT');
    await safeAudit(req.user.id, 'task_create', 'task', taskId, 'assignees=' + ids.join(','));
    const row = await fetchTask(taskId);
    res.status(201).json(row);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { }
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  } finally {
    client.release();
  }
});

router.post('/:id/restore', authenticate, authorizeRole(['admin']), async function (req, res) {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(404).json({ error: 'Task not found' });
  try {
    const r = await query('UPDATE tasks SET deleted = FALSE WHERE id = $1 AND deleted = TRUE RETURNING id', [taskId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Task not found in archive' });
    await safeAudit(req.user.id, 'task_restore', 'task', taskId, '');
    res.json({ id: taskId, message: 'Restored' });
  } catch (err) {
    console.error('Restore task error:', err);
    res.status(500).json({ error: 'Failed to restore task' });
  }
});

router.patch('/:id', authenticate, async function (req, res) {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(404).json({ error: 'Task not found' });
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const title = req.body.title;
  const description = req.body.description;
  const status = req.body.status;
  const ids = cleanIds(req.body.assignee_ids);
  try {
    const checkRes = await query(
      'SELECT t.*, EXISTS(SELECT 1 FROM task_assignees WHERE task_id = t.id AND user_id = $2) AS is_assigned FROM tasks t WHERE t.id = $1 AND t.deleted = FALSE',
      [taskId, userId]
    );
    if (checkRes.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = checkRes.rows[0];
    if (!isAdmin && !task.is_assigned) return res.status(403).json({ error: 'Forbidden' });
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (isAdmin && title !== undefined && !String(title).trim()) return res.status(400).json({ error: 'Title required' });
    if (isAdmin && Array.isArray(req.body.assignee_ids) && !(await assigneesExist(ids))) {
      return res.status(400).json({ error: 'Unknown assignee id' });
    }
    const updates = [];
    const values = [];
    let p = 1;
    if (isAdmin) {
      if (title !== undefined) { updates.push('title = $' + p++); values.push(String(title).trim()); }
      if (description !== undefined) { updates.push('description = $' + p++); values.push(String(description)); }
      if (status !== undefined) { updates.push('status = $' + p++); values.push(status); }
    } else if (status !== undefined) {
      updates.push('status = $' + p++); values.push(status);
    }
    if (updates.length > 0) {
      values.push(taskId);
      await query('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = $' + p, values);
    }
    if (isAdmin && Array.isArray(req.body.assignee_ids)) {
      await query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
      for (const uid of ids) {
        await query('INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1, $2, $3)', [taskId, uid, userId]);
      }
    }
    await safeAudit(userId, 'task_update', 'task', taskId, 'fields=' + Object.keys(req.body).join(','));
    const row = await fetchTask(taskId);
    res.json(row);
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', authenticate, authorizeRole(['admin']), async function (req, res) {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(404).json({ error: 'Task not found' });
  try {
    const r = await query('UPDATE tasks SET deleted = TRUE WHERE id = $1 AND deleted = FALSE RETURNING id', [taskId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    await safeAudit(req.user.id, 'task_delete', 'task', taskId, '');
    res.json({ id: taskId, message: 'Archived' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Failed to archive task' });
  }
});

module.exports = router;