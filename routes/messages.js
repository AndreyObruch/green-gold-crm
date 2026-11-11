const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const router = express.Router();

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

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function getTask(taskId) {
  return get('SELECT id, deleted FROM tasks WHERE id = ?', [taskId]);
}

async function canAccessTask(task, user) {
  if (!task) return false;
  if (user.role === 'admin') return true;

  const assigned = await get(
    'SELECT 1 AS ok FROM task_assignees WHERE task_id = ? AND user_id = ?',
    [task.id, user.id]
  );
  return !!assigned;
}

router.get('/', auth, async (req, res) => {
  try {
    const taskId = parseInt(req.query.task_id, 10);
    if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });

    const task = await getTask(taskId);
    if (!task || task.deleted === 1) return res.status(404).json({ error: 'Task not found' });

    const allowed = await canAccessTask(task, req.user);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'messages_list_denied', 'message', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }

    const rows = await all(
      'SELECT m.*, ' +
      'u.username AS author_username, ' +
      'f.original_name AS file_name, ' +
      'f.size AS file_size, ' +
      'f.mime AS file_mime ' +
      'FROM messages m ' +
      'LEFT JOIN users u ON u.id = m.user_id ' +
      'LEFT JOIN files f ON f.id = m.file_id ' +
      'WHERE m.task_id = ? ' +
      'ORDER BY m.created_at ASC, m.id ASC',
      [taskId]
    );

    res.json(rows);
  } catch (e) {
    console.error('messages list', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const taskId = parseInt(req.body.task_id, 10);
    if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });

    const bodyText = req.body.body != null ? String(req.body.body).trim().slice(0, 2000) : '';
    const fileIdRaw = req.body.file_id;
    const fileId = fileIdRaw ? parseInt(fileIdRaw, 10) : null;

    if (!bodyText && !fileId) {
      return res.status(400).json({ error: 'body or file_id required' });
    }

    const task = await getTask(taskId);
    if (!task || task.deleted === 1) return res.status(404).json({ error: 'Task not found' });

    const allowed = await canAccessTask(task, req.user);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'message_post_denied', 'message', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }

    if (fileId) {
      const file = await get('SELECT id, task_id FROM files WHERE id = ?', [fileId]);
      if (!file) return res.status(404).json({ error: 'File not found' });
      if (file.task_id !== taskId) {
        return res.status(400).json({ error: 'File does not belong to task' });
      }
    }

    const insert = await run(
      'INSERT INTO messages (task_id, user_id, body, file_id) VALUES (?, ?, ?, ?)',
      [taskId, req.user.id, bodyText || null, fileId]
    );

    audit(req.user.id, req.user.username, 'message_post', 'message', insert.lastID, 'task=' + taskId);

    res.json({
      id: insert.lastID,
      task_id: taskId,
      user_id: req.user.id,
      body: bodyText || null,
      file_id: fileId
    });
  } catch (e) {
    console.error('message post', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;