const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const up = require('../middleware/upload');
const router = express.Router();

function getTask(id, cb) {
  db.get('SELECT id, assignee_id, deleted FROM tasks WHERE id = ?', [id], (e, r) => cb(e ? null : r));
}
function canAccess(task, user) {
  if (!task) return false;
  if (user.role === 'admin') return true;
  return task.assignee_id === user.id;
}

router.post('/', auth, (req, res) => {
  up.upload.array('files', up.MAX_FILES)(req, res, async (err) => {
    if (err) {
      const map = {
        EXT_NOT_ALLOWED: 'Extension not allowed',
        LIMIT_FILE_SIZE: 'File too large (max 10MB)',
        LIMIT_FILE_COUNT: 'Too many files (max 3)',
        LIMIT_UNEXPECTED_FILE: 'Unexpected field'
      };
      return res.status(400).json({ error: map[err.code] || map[err.message] || err.message });
    }
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files' });
    const cleanup = () => { files.forEach((f) => { fs.unlink(f.path, () => {}); }); };

    for (const f of files) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      const ok = await up.verifyMagic(f.path, ext);
      if (!ok) { cleanup(); return res.status(400).json({ error: 'File content does not match extension' }); }
    }

    let taskId = null;
    const raw = req.body.task_id;
    if (raw !== undefined && raw !== null && raw !== '') {
      taskId = parseInt(raw, 10);
      if (isNaN(taskId)) { cleanup(); return res.status(400).json({ error: 'Invalid task_id' }); }
      const task = await new Promise((r) => getTask(taskId, r));
      if (!task || !canAccess(task, req.user)) {
        cleanup();
        audit(req.user.id, req.user.username, 'file_upload_denied', 'file', null, 'task_access');
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const inserted = [];
    for (const f of files) {
      const buf = await fs.promises.readFile(f.path);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const id = await new Promise((resolve) => {
        db.run('INSERT INTO files (task_id, uploader_id, original_name, stored_name, mime, size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [taskId, req.user.id, f.originalname, f.filename, f.mimetype, f.size, sha],
          function (e) { resolve(e ? null : this.lastID); });
      });
      if (id === null) { cleanup(); return res.status(500).json({ error: 'DB insert failed' }); }
      inserted.push({ id: id, name: f.originalname, size: f.size });
    }
    audit(req.user.id, req.user.username, 'file_upload', 'file', inserted[0].id, 'count=' + inserted.length + ' task=' + (taskId || '-'));
    res.json({ files: inserted });
  });
});

router.get('/', auth, (req, res) => {
  const taskId = parseInt(req.query.task_id, 10);
  if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });
  getTask(taskId, (task) => {
    if (!task || !canAccess(task, req.user)) {
      audit(req.user.id, req.user.username, 'file_list_denied', 'file', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }
    db.all('SELECT id, task_id, uploader_id, original_name, mime, size, created_at FROM files WHERE task_id = ? ORDER BY id', [taskId], (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows);
    });
  });
});

router.get('/:id/download', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  db.get('SELECT f.*, t.assignee_id AS task_assignee FROM files f LEFT JOIN tasks t ON f.task_id = t.id WHERE f.id = ?', [id], (e, f) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!f) return res.status(404).json({ error: 'File not found' });
    const allowed = req.user.role === 'admin' || (f.task_id ? f.task_assignee === req.user.id : f.uploader_id === req.user.id);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'file_download_denied', 'file', id, 'not_owner');
      return res.status(403).json({ error: 'Access denied' });
    }
    const p = path.join(up.UPLOAD_DIR, f.stored_name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Stored file missing' });
    audit(req.user.id, req.user.username, 'file_download', 'file', id, f.original_name);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(p, f.original_name);
  });
});

module.exports = router;