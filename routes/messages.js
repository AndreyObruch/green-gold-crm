const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const router = express.Router();

const MAX_MESSAGE_FILES = 3;

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

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function normalizeFileIds(body) {
  let raw = [];

  if (Array.isArray(body.file_ids)) {
    raw = body.file_ids;
  } else if (body.file_id !== undefined && body.file_id !== null && body.file_id !== '') {
    raw = [body.file_id];
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

  if (ids.length > MAX_MESSAGE_FILES) {
    throw httpError(400, 'Max ' + MAX_MESSAGE_FILES + ' files per message');
  }

  return ids;
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

async function loadMessagesWithFiles(taskId) {
  const rows = await all(
    'SELECT m.*, u.username AS author_username ' +
    'FROM messages m ' +
    'LEFT JOIN users u ON u.id = m.user_id ' +
    'WHERE m.task_id = ? ' +
    'ORDER BY m.created_at ASC, m.id ASC',
    [taskId]
  );

  const messageIds = rows.map(r => r.id).filter(Boolean);
  if (!messageIds.length) {
    return rows.map(r => ({ ...r, files: [], file_id: null }));
  }

  const placeholders = messageIds.map(() => '?').join(',');
  const fileRows = await all(
    'SELECT mf.message_id AS messageId, ' +
    'f.id, f.original_name, f.size, f.mime ' +
    'FROM message_files mf ' +
    'JOIN files f ON f.id = mf.file_id ' +
    'WHERE mf.message_id IN (' + placeholders + ') ' +
    'ORDER BY mf.message_id, f.id',
    messageIds
  );

  const map = new Map();
  for (const fr of fileRows) {
    if (!map.has(fr.messageId)) map.set(fr.messageId, []);
    map.get(fr.messageId).push({
      id: fr.id,
      original_name: fr.original_name,
      size: fr.size,
      mime: fr.mime
    });
  }

  return rows.map(r => {
    const files = map.get(r.id) || [];
    return {
      ...r,
      files,
      file_id: files.length ? files[0].id : null
    };
  });
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

    const rows = await loadMessagesWithFiles(taskId);
    res.json(rows);
  } catch (e) {
    console.error('messages list', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  let began = false;

  try {
    const taskId = parseInt(req.body.task_id, 10);
    if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });

    const bodyText = req.body.body != null ? String(req.body.body).trim().slice(0, 2000) : '';
    const fileIds = normalizeFileIds(req.body || {});

    if (!bodyText && fileIds.length === 0) {
      return res.status(400).json({ error: 'body or file_ids required' });
    }

    const task = await getTask(taskId);
    if (!task || task.deleted === 1) return res.status(404).json({ error: 'Task not found' });

    const allowed = await canAccessTask(task, req.user);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'message_post_denied', 'message', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }

    if (fileIds.length) {
      const placeholders = fileIds.map(() => '?').join(',');
      const files = await all(
        'SELECT id, task_id FROM files WHERE id IN (' + placeholders + ')',
        fileIds
      );

      if (files.length !== fileIds.length) {
        return res.status(400).json({ error: 'One or more file ids not found' });
      }

      for (const f of files) {
        if (f.task_id !== taskId) {
          return res.status(400).json({ error: 'File does not belong to task' });
        }
      }
    }

    await run('BEGIN');
    began = true;

    const insert = await run(
      'INSERT INTO messages (task_id, user_id, body, file_id) VALUES (?, ?, ?, ?)',
      [taskId, req.user.id, bodyText || null, fileIds.length ? fileIds[0] : null]
    );

    const messageId = insert.lastID;

    for (const fileId of fileIds) {
      await run(
        'INSERT OR IGNORE INTO message_files (message_id, file_id) VALUES (?, ?)',
        [messageId, fileId]
      );
    }

    await run('COMMIT');
    began = false;

    audit(
      req.user.id,
      req.user.username,
      'message_post',
      'message',
      messageId,
      'task=' + taskId + ' files=' + fileIds.length
    );

    res.json({
      id: messageId,
      task_id: taskId,
      user_id: req.user.id,
      body: bodyText || null,
      file_ids: fileIds
    });
  } catch (e) {
    if (began) {
      try {
        await run('ROLLBACK');
      } catch (rollbackError) {
        console.error('message rollback', rollbackError);
      }
    }

    console.error('message post', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;