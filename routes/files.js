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