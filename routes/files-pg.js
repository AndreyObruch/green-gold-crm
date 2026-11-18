const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query, pool } = require('../db/pg-db');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const router = express.Router();

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

const persistentRoot = '/data';
const uploadDir = process.env.UPLOAD_DIR || (fs.existsSync(persistentRoot) ? path.join(persistentRoot, 'uploads') : path.join(__dirname, '..', 'uploads'));
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
  }
});

const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.csv', '.txt', '.md'];
const maxSize = 10 * 1024 * 1024;

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error('File type ' + ext + ' not allowed'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: maxSize, files: 3 },
  fileFilter: fileFilter
});

function uploadArray(req, res, next) {
  upload.array('files', 3)(req, res, function (err) {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}

function cleanupFiles(files) {
  (files || []).forEach(function (f) {
    try { fs.unlinkSync(f.path); } catch (e) { }
  });
}

async function handleUpload(req, res) {
  const taskId = parseInt(req.body.task_id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0 || !req.files || req.files.length === 0) {
    cleanupFiles(req.files);
    return res.status(400).json({ error: 'Task ID and files required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskCheck = await client.query(
      'SELECT t.id FROM tasks t LEFT JOIN task_assignees ta ON ta.task_id = t.id WHERE t.id = $1 AND t.deleted = FALSE AND (t.creator_id = $2 OR ta.user_id = $2 OR $3 = \'admin\')',
      [taskId, req.user.id, req.user.role]
    );
    if (taskCheck.rows.length === 0) {
      throw new Error('Forbidden or Task not found');
    }
    const insertedFiles = [];
    for (const file of req.files) {
      const originalName = decodeName(file.originalname);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
      const result = await client.query(
        'INSERT INTO files (task_id, uploader_id, original_name, stored_name, size, mime, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [taskId, req.user.id, originalName, file.filename, file.size, file.mimetype, sha256]
      );
      insertedFiles.push({
        id: result.rows[0].id,
        name: originalName,
        original_name: originalName,
        size: file.size,
        mime: file.mimetype
      });
    }
    await client.query('COMMIT');
    try {
      await logAudit(req.user.id, 'file_upload', 'file', insertedFiles[0].id, 'count=' + insertedFiles.length + ' task=' + taskId);
    } catch (e) { }
    res.json({ message: 'Files uploaded', files: insertedFiles });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { }
    cleanupFiles(req.files);
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload files' });
  } finally {
    client.release();
  }
}

router.post('/', authenticate, uploadArray, handleUpload);
router.post('/upload', authenticate, uploadArray, handleUpload);

router.get('/', authenticate, async (req, res) => {
  const taskId = parseInt(req.query.task_id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Task ID required' });
  try {
    let sql;
    let params;
    if (req.user.role === 'admin') {
      sql = 'SELECT id, task_id, uploader_id, original_name, size, mime, created_at FROM files WHERE task_id = $1 ORDER BY created_at DESC';
      params = [taskId];
    } else {
      sql = 'SELECT f.id, f.task_id, f.uploader_id, f.original_name, f.size, f.mime, f.created_at FROM files f INNER JOIN task_assignees ta ON ta.task_id = f.task_id WHERE f.task_id = $1 AND ta.user_id = $2 ORDER BY f.created_at DESC';
      params = [taskId, req.user.id];
    }
    const result = await query(sql, params);
    res.json(result.rows.map(function (r) {
      r.original_name = decodeName(r.original_name);
      return r;
    }));
  } catch (err) {
    console.error('Get files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/download', authenticate, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!Number.isInteger(fileId) || fileId <= 0) return res.status(404).json({ error: 'File not found' });
  try {
    const result = await query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });
    const fileMeta = result.rows[0];
    let hasAccess = false;
    if (req.user.role === 'admin') {
      hasAccess = true;
    } else {
      const assigneeCheck = await query('SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2', [fileMeta.task_id, req.user.id]);
      hasAccess = assigneeCheck.rows.length > 0;
    }
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });
    const filePath = path.join(uploadDir, fileMeta.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Physical file missing' });
    res.download(filePath, decodeName(fileMeta.original_name), function (err) {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;