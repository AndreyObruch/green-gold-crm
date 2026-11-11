const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const router = express.Router();

const STATUSES = ['new', 'in_progress', 'done'];
const MAX_ASSIGNEES = 10;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function normalizeAssigneeIds(body) {
  let raw = [];
  if (Array.isArray(body.assignee_ids)) {
    raw = body.assignee_ids;
  } else if (body.assignee_id !== undefined && body.assignee_id !== null && body.assignee_id !== '') {
    raw = [body.assignee_id];
  }

  const ids = [];
  const seen = new Set();
  for (const v of raw) {
    const n = parseInt(v, 10);
    if (!Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }

  if (ids.length > MAX_ASSIGNEES) {
    throw httpError(400, 'Max ' + MAX_ASSIGNEES + ' assignees');
  }
  return ids;
}

async function assertUsersExist(ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all('SELECT id FROM users WHERE id IN (' + placeholders + ')', ids);
  if (rows.length !== ids.length) {
    throw httpError(400, 'One or more assignee ids not found');
  }
}

async function replaceAssignees(taskId, ids, assignedBy) {
  await run('DELETE FROM task_assignees WHERE task_id = ?', [taskId]);
  for (const userId of ids) {
    await run(
      'INSERT OR IGNORE INTO task_assignees (task_id, user_id, assigned_by) VALUES (?, ?, ?)',
      [taskId, userId, assignedBy]
    );
  }
}

async function decorateTasks(tasks) {
  const ids = (tasks || []).map(t => t.id).filter(Boolean);
  if (!ids.length) {
    return (tasks || []).map(t => ({
      ...t,
      assignees: [],
      assignee_id: null,
      assignee_username: null
    }));
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = await all(
    'SELECT ta.task_id AS taskId, ta.user_id AS userId, u.username AS username ' +
    'FROM task_assignees ta ' +
    'JOIN users u ON u.id = ta.user_id ' +
    'WHERE ta.task_id IN (' + placeholders + ') ' +
    'ORDER BY ta.task_id, u.username',
    ids
  );

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.taskId)) map.set(r.taskId, []);
    map.get(r.taskId).push({ id: r.userId, username: r.username });
  }

  return (tasks || []).map(t => {
    const assignees = map.get(t.id) || [];
    return {
      ...t,
      assignees,
      assignee_id: assignees.length ? assignees[0].id : null,
      assignee_username: assignees.length ? assignees.map(a => a.username).join(', ') : null
    };
  });
}

async function fetchTaskDecorated(id) {
  const row = await get(
    'SELECT t.*, cu.username AS creator_username ' +
    'FROM tasks t ' +
    'LEFT JOIN users cu ON cu.id = t.creator_id ' +
    'WHERE t.id = ?',
    [id]
  );
  if (!row) return null;
  const decorated = await decorateTasks([row]);
  return decorated[0];
}

router.get('/', auth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = await all(
        'SELECT t.*, cu.username AS creator_username ' +
        'FROM tasks t ' +
        'LEFT JOIN users cu ON cu.id = t.creator_id ' +
        'WHERE t.deleted = 0 ' +
        'ORDER BY t.created_at DESC'
      );
    } else {
      rows = await all(
        'SELECT t.*, cu.username AS creator_username ' +
        'FROM tasks t ' +
        'LEFT JOIN users cu ON cu.id = t.creator_id ' +
        'JOIN task_assignees ta ON ta.task_id = t.id ' +
        'WHERE t.deleted = 0 AND ta.user_id = ? ' +
        'ORDER BY t.created_at DESC',
        [req.user.id]
      );
    }

    const tasks = await decorateTasks(rows);
    res.json(tasks);
  } catch (e) {
    console.error('tasks list', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      audit(req.user.id, req.user.username, 'task_create_denied', 'task', null, 'not_admin');
      return res.status(403).json({ error: 'Admin only' });
    }

    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title required' });

    const description = String(req.body.description || '').slice(0, 5000);
    const ids = normalizeAssigneeIds(req.body);
    await assertUsersExist(ids);

    const insert = await run(
      'INSERT INTO tasks (title, description, status, assignee_id, creator_id) VALUES (?, ?, ?, ?, ?)',
      [title, description, 'new', ids.length ? ids[0] : null, req.user.id]
    );

    const taskId = insert.lastID;
    await replaceAssignees(taskId, ids, req.user.id);

    const task = await fetchTaskDecorated(taskId);
    audit(req.user.id, req.user.username, 'task_create', 'task', taskId, 'assignees=' + ids.join(','));
    res.status(201).json(task);
  } catch (e) {
    console.error('tasks create', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const task = await get('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const isAdmin = req.user.role === 'admin';
    const body = req.body || {};

    if (!isAdmin) {
      const assigned = await get(
        'SELECT 1 AS ok FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [id, req.user.id]
      );
      if (!assigned) {
        audit(req.user.id, req.user.username, 'task_update_denied', 'task', id, 'not_assignee');
        return res.status(403).json({ error: 'Access denied' });
      }

      const forbidden = Object.keys(body).filter(k => k !== 'status');
      if (forbidden.length) {
        audit(req.user.id, req.user.username, 'task_priv_esc_attempt', 'task', id, forbidden.join(','));
        return res.status(403).json({ error: 'Executor can update only status' });
      }
    }

    const updates = [];
    const params = [];
    const changed = [];

    if (isAdmin && Object.prototype.hasOwnProperty.call(body, 'title')) {
      const title = String(body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Title required' });
      updates.push('title = ?');
      params.push(title);
      changed.push('title');
    }

    if (isAdmin && Object.prototype.hasOwnProperty.call(body, 'description')) {
      const description = String(body.description || '').slice(0, 5000);
      updates.push('description = ?');
      params.push(description);
      changed.push('description');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const status = String(body.status);
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.push('status = ?');
      params.push(status);
      changed.push('status');
    }

    if (isAdmin && (Object.prototype.hasOwnProperty.call(body, 'assignee_ids') || Object.prototype.hasOwnProperty.call(body, 'assignee_id'))) {
      const ids = normalizeAssigneeIds(body);
      await assertUsersExist(ids);
      await replaceAssignees(id, ids, req.user.id);
      updates.push('assignee_id = ?');
      params.push(ids.length ? ids[0] : null);
      changed.push('assignees');
    }

    if (updates.length) {
      params.push(id);
      await run('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = ?', params);
    }

    const updated = await fetchTaskDecorated(id);
    audit(req.user.id, req.user.username, 'task_update', 'task', id, changed.join(','));
    res.json(updated);
  } catch (e) {
    console.error('tasks patch', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      audit(req.user.id, req.user.username, 'task_delete_denied', 'task', req.params.id, 'not_admin');
      return res.status(403).json({ error: 'Admin only' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const r = await run('UPDATE tasks SET deleted = 1 WHERE id = ? AND deleted = 0', [id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Task not found' });

    audit(req.user.id, req.user.username, 'task_soft_delete', 'task', id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('tasks delete', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.get('/archive', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      audit(req.user.id, req.user.username, 'archive_list_denied', 'task', null, 'not_admin');
      return res.status(403).json({ error: 'Admin only' });
    }

    const rows = await all(
      'SELECT t.*, cu.username AS creator_username ' +
      'FROM tasks t ' +
      'LEFT JOIN users cu ON cu.id = t.creator_id ' +
      'WHERE t.deleted = 1 ' +
      'ORDER BY t.created_at DESC'
    );

    const tasks = await decorateTasks(rows);
    res.json(tasks);
  } catch (e) {
    console.error('tasks archive', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.post('/:id/restore', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      audit(req.user.id, req.user.username, 'task_restore_denied', 'task', req.params.id, 'not_admin');
      return res.status(403).json({ error: 'Admin only' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const r = await run('UPDATE tasks SET deleted = 0 WHERE id = ? AND deleted = 1', [id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Task not found in archive' });

    const task = await fetchTaskDecorated(id);
    audit(req.user.id, req.user.username, 'task_restore', 'task', id, '');
    res.json(task);
  } catch (e) {
    console.error('tasks restore', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;