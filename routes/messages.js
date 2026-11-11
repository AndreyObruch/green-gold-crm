const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const router = express.Router();

function getTask(id, cb) {
  db.get('SELECT id, assignee_id, deleted FROM tasks WHERE id = ?', [id], (e, r) => cb(e ? null : r));
}
function canAccess(task, user) {
  if (!task) return false;
  if (user.role === 'admin') return true;
  return task.assignee_id === user.id;
}

router.get('/', auth, (req, res) => {
  const taskId = parseInt(req.query.task_id, 10);
  if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });
  getTask(taskId, (task) => {
    if (!task || task.deleted === 1) return res.status(404).json({ error: 'Task not found' });
    if (!canAccess(task, req.user)) {
      audit(req.user.id, req.user.username, 'messages_list_denied', 'message', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }
    db.all('SELECT m.*, u.username AS author_username FROM messages m LEFT JOIN users u ON m.user_id = u.id WHERE m.task_id = ? ORDER BY m.created_at ASC, m.id ASC', [taskId], (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows);
    });
  });
});

router.post('/', auth, (req, res) => {
  const taskId = parseInt(req.body.task_id, 10);
  if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });
  const body = req.body.body ? String(req.body.body).slice(0, 2000) : null;
  const fileIdRaw = req.body.file_id;
  const fileId = fileIdRaw ? parseInt(fileIdRaw, 10) : null;
  if (!body && !fileId) return res.status(400).json({ error: 'body or file_id required' });
  getTask(taskId, (task) => {
    if (!task || task.deleted === 1) return res.status(404).json({ error: 'Task not found' });
    if (!canAccess(task, req.user)) {
      audit(req.user.id, req.user.username, 'message_post_denied', 'message', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }
    if (fileId) {
      db.get('SELECT id, task_id, uploader_id FROM files WHERE id = ?', [fileId], (e, f) => {
        if (e) return res.status(500).json({ error: e.message });
        if (!f) return res.status(404).json({ error: 'File not found' });
        if (f.task_id !== taskId) return res.status(400).json({ error: 'File does not belong to task' });
        const allowed = req.user.role === 'admin' || f.uploader_id === req.user.id;
        if (!allowed) return res.status(403).json({ error: 'Access denied' });
        insertMessage(taskId, req.user.id, body, fileId, res);
      });
      return;
    }
    insertMessage(taskId, req.user.id, body, null, res);
  });
});

function insertMessage(taskId, userId, body, fileId, res) {
  db.run('INSERT INTO messages (task_id, user_id, body, file_id) VALUES (?, ?, ?, ?)',
    [taskId, userId, body, fileId],
    function (e) {
      if (e) return res.status(500).json({ error: e.message });
      audit(userId, null, 'message_post', 'message', this.lastID, 'task=' + taskId);
      res.json({ id: this.lastID, task_id: taskId, user_id: userId, body: body, file_id: fileId });
    }
  );
}

module.exports = router;