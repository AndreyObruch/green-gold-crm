const express = require('express');
const { query, pool } = require('../db/pg-db');
const { authenticate, authorizeRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const router = express.Router();

const MAX_BODY = 4000;

function decodeName(name) {
  if (typeof name !== 'string' || !name) return 'file';
  if (/[\u00C2-\u00F4][\u0080-\u00BF]/.test(name)) {
    try {
      const fixed = Buffer.from(name, 'latin1').toString('utf8');
      if (fixed && fixed.indexOf('\uFFFD') === -1) return fixed;
    } catch (e) { }
  }
  return name;
}

function cleanIds(raw) {
  if (!Array.isArray(raw)) return [];
  const nums = raw.map(function (x) { return parseInt(x, 10); }).filter(function (n) { return Number.isInteger(n) && n > 0; });
  return Array.from(new Set(nums));
}

async function safeAudit(userId, action, entity, entityId, detail) {
  try {
    await logAudit(userId, action, entity, entityId, detail);
  } catch (e) {
    console.error('Audit failed:', e.message);
  }
}

async function canAccessTask(taskId, user) {
  if (user.role === 'admin') return true;
  const r = await query('SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2', [taskId, user.id]);
  return r.rows.length > 0;
}

const MESSAGE_SELECT =
  'SELECT m.*, u.username AS author_username, ' +
  '(SELECT COALESCE(json_agg(json_build_object(\'id\', f.id, \'original_name\', f.original_name, \'size\', f.size, \'mime\', f.mime) ORDER BY f.id), \'[]\'::json) ' +
  'FROM message_files mf JOIN files f ON f.id = mf.file_id WHERE mf.message_id = m.id) AS files ' +
  'FROM messages m LEFT JOIN users u ON u.id = m.user_id';

function hydrate(row) {
  row.files = Array.isArray(row.files) ? row.files.map(function (f) {
    f.original_name = decodeName(f.original_name);
    return f;
  }) : [];
  return row;
}

async function attachLegacy(rows) {
  const need = rows.filter(function (r) { return (!r.files || r.files.length === 0) && r.legacy_file_id; });
  if (need.length === 0) return rows;
  const ids = Array.from(new Set(need.map(function (r) { return r.legacy_file_id; })));
  const fr = await query('SELECT id, original_name, size, mime FROM files WHERE id = ANY($1::int[])', [ids]);
  const map = {};
  fr.rows.forEach(function (f) {
    map[f.id] = { id: f.id, original_name: decodeName(f.original_name), size: f.size, mime: f.mime };
  });
  need.forEach(function (r) {
    if (map[r.legacy_file_id]) r.files = [map[r.legacy_file_id]];
  });
  return rows;
}

async function fetchMessage(id) {
  const r = await query(MESSAGE_SELECT + ' WHERE m.id = $1', [id]);
  if (r.rows.length === 0) return null;
  const rows = await attachLegacy([hydrate(r.rows[0])]);
  return rows[0];
}

router.get('/', authenticate, async function (req, res) {
  const taskId = parseInt(req.query.task_id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Task ID required' });
  try {
    if (!(await canAccessTask(taskId, req.user))) return res.status(403).json({ error: 'Forbidden' });
    const r = await query(MESSAGE_SELECT + ' WHERE m.task_id = $1 ORDER BY m.created_at ASC, m.id ASC', [taskId]);
    const rows = await attachLegacy(r.rows.map(hydrate));
    res.json(rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, async function (req, res) {
  const taskId = parseInt(req.body.task_id, 10);
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  const fileIds = cleanIds(req.body.file_ids);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Task ID required' });
  if (!body && fileIds.length === 0) return res.status(400).json({ error: 'Message body or files required' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: 'Message too long' });
  try {
    if (!(await canAccessTask(taskId, req.user))) return res.status(403).json({ error: 'Forbidden' });
    if (fileIds.length > 0) {
      const fr = await query(
        'SELECT id FROM files WHERE id = ANY($1::int[]) AND task_id = $2 AND (uploader_id = $3 OR $4 = \'admin\')',
        [fileIds, taskId, req.user.id, req.user.role]
      );
      if (fr.rows.length !== fileIds.length) return res.status(400).json({ error: 'Files must belong to this task and uploader' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mr = await client.query(
        'INSERT INTO messages (task_id, user_id, body, legacy_file_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [taskId, req.user.id, body || null, fileIds.length ? fileIds[0] : null]
      );
      const messageId = mr.rows[0].id;
      for (const fid of fileIds) {
        await client.query('INSERT INTO message_files (message_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [messageId, fid]);
      }
      await client.query('COMMIT');
      await safeAudit(req.user.id, 'message_create', 'message', messageId, 'task=' + taskId + ' files=' + fileIds.length);
      const row = await fetchMessage(messageId);
      res.status(201).json(row);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create message error:', err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

router.patch('/:id', authenticate, authorizeRole(['admin']), async function (req, res) {
  const id = parseInt(req.params.id, 10);
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Message not found' });
  if (!body) return res.status(400).json({ error: 'Message body required' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: 'Message too long' });
  try {
    const r = await query('UPDATE messages SET body = $1 WHERE id = $2 RETURNING id', [body, id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    await safeAudit(req.user.id, 'message_update', 'message', id, '');
    const row = await fetchMessage(id);
    res.json(row);
  } catch (err) {
    console.error('Update message error:', err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

router.delete('/:id', authenticate, async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Message not found' });
  try {
    const r = await query('SELECT id, user_id, task_id FROM messages WHERE id = $1', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const msg = r.rows[0];
    if (req.user.role !== 'admin' && msg.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await query('DELETE FROM messages WHERE id = $1', [id]);
    await safeAudit(req.user.id, 'message_delete', 'message', id, 'task=' + msg.task_id);
    res.json({ id: id, message: 'Deleted' });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;