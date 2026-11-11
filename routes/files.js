const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const up = require('../middleware/upload');
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

function decodeName(name) {
  if (!name) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed.indexOf('\uFFFD') !== -1) return name;
    return fixed;
  } catch (e) {
    return name;
  }
}

async function getActiveTask(taskId) {
  return get('SELECT id, deleted FROM tasks WHERE id = ? AND deleted = 0', [taskId]);
}

async function isAssigned(taskId, userId) {
  const row = await get(
    'SELECT 1 AS ok FROM task_assignees WHERE task_id = ? AND user_id = ?',
    [taskId, userId]
  );
  return !!row;
}

async function canAccessTask(task, user) {
  if (!task) return false;
  if (user.role === 'admin') return true;
  return isAssigned(task.id, user.id);
}

router.post('/', auth, async (req, res) => {
  try {
    const taskId = parseInt(req.body.task_id, 10);
    if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });

    const task = await getActiveTask(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const allowed = await canAccessTask(task, req.user);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'file_upload_denied', 'file', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }

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

      const cleanup = () => {
        files.forEach((f) => {
          fs.unlink(f.path, () => {});
        });
      };

      try {
        for (const f of files) {
          const ext = path.extname(decodeName(f.originalname) || '').toLowerCase();
          const ok = await up.verifyMagic(f.path, ext);
          if (!ok) {
            cleanup();
            return res.status(400).json({ error: 'File content does not match extension' });
          }
        }

        const inserted = [];
        for (const f of files) {
          const buf = await fs.promises.readFile(f.path);
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          const realName = decodeName(f.originalname);

          const ins = await run(
            'INSERT INTO files (task_id, uploader_id, original_name, stored_name, mime, size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [taskId, req.user.id, realName, f.filename, f.mimetype, f.size, sha]
          );

          inserted.push({ id: ins.lastID, name: realName, size: f.size });
        }

        audit(req.user.id, req.user.username, 'file_upload', 'file', inserted[0].id, 'count=' + inserted.length + ' task=' + taskId);
        res.json({ files: inserted });
      } catch (e) {
        cleanup();
        console.error('file upload db', e);
        res.status(500).json({ error: e.message || 'Server error' });
      }
    });
  } catch (e) {
    console.error('file upload guard', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const taskId = parseInt(req.query.task_id, 10);
    if (isNaN(taskId)) return res.status(400).json({ error: 'task_id required' });

    const task = await getActiveTask(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const allowed = await canAccessTask(task, req.user);
    if (!allowed) {
      audit(req.user.id, req.user.username, 'file_list_denied', 'file', null, 'task_access');
      return res.status(403).json({ error: 'Access denied' });
    }

    const rows = await all(
      'SELECT id, task_id, uploader_id, original_name, mime, size, created_at FROM files WHERE task_id = ? ORDER BY id',
      [taskId]
    );

    res.json(rows);
  } catch (e) {
    console.error('files list', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/:id/download', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const file = await get(
      'SELECT f.*, t.deleted AS task_deleted FROM files f LEFT JOIN tasks t ON t.id = f.task_id WHERE f.id = ?',
      [id]
    );

    if (!file) return res.status(404).json({ error: 'File not found' });

    let allowed = false;
    if (req.user.role === 'admin') {
      allowed = true;
    } else if (file.task_id && file.task_deleted === 0) {
      allowed = await isAssigned(file.task_id, req.user.id);
    } else {
      allowed = file.uploader_id === req.user.id;
    }

    if (!allowed) {
      audit(req.user.id, req.user.username, 'file_download_denied', 'file', id, 'not_assigned');
      return res.status(403).json({ error: 'Access denied' });
    }

    const p = path.join(up.UPLOAD_DIR, file.stored_name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Stored file missing' });

    audit(req.user.id, req.user.username, 'file_download', 'file', id, file.original_name);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(p, file.original_name);
  } catch (e) {
    console.error('file download', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;