const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query, pool } = require('../db/pg-db');
const { authenticate, authorizeRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

// Настройка хранилища для Amvera (временная папка или persistent volume)
// Важно: на Amvera файловая система эфемерна. Для прода нужно использовать S3-compatible storage (Yandex Object Storage и т.д.)
// Сейчас используем локальную папку uploads для теста миграции структуры БД.
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.csv', '.txt', '.md'];
const maxSize = 10 * 1024 * 1024; // 10 MB

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`File type ${ext} not allowed`), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage: storage, 
  limits: { fileSize: maxSize, files: 3 }, 
  fileFilter: fileFilter 
});

// POST /api/files/upload
router.post('/upload', authenticate, upload.array('files', 3), async (req, res) => {
  const { task_id } = req.body;
  
  if (!task_id || !req.files || req.files.length === 0) {
    // Cleanup temp files if validation failed before DB insert
    if (req.files) req.files.forEach(f => fs.unlinkSync(f.path));
    return res.status(400).json({ error: 'Task ID and files required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verify task exists and user has access
    const taskCheck = await client.query(
      'SELECT t.id FROM tasks t LEFT JOIN task_assignees ta ON ta.task_id = t.id WHERE t.id = $1 AND (t.creator_id = $2 OR ta.user_id = $2 OR $3 = \'admin\')',
      [task_id, req.user.id, req.user.role]
    );
    
    if (taskCheck.rows.length === 0) {
      throw new Error('Forbidden or Task not found');
    }

    const insertedFiles = [];
    
    for (const file of req.files) {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
      
      const result = await client.query(
        `INSERT INTO files (task_id, uploader_id, original_name, stored_name, size, mime, sha256) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [task_id, req.user.id, file.originalname, file.filename, file.size, file.mimetype, sha256]
      );
      
      insertedFiles.push({
        id: result.rows[0].id,
        original_name: file.originalname,
        size: file.size,
        mime: file.mimetype
      });
    }

    await client.query('COMMIT');
    
    await logAudit(req.user.id, 'file_upload', 'file', insertedFiles.map(f => f.id).join(','), `count=${insertedFiles.length} task=${task_id}`);
    
    res.json({ message: 'Files uploaded', files: insertedFiles });
  } catch (err) {
    await client.query('ROLLBACK');
    // Cleanup on error
    if (req.files) req.files.forEach(f => {
      try { fs.unlinkSync(f.path); } catch(e){}
    });
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload files' });
  } finally {
    client.release();
  }
});

// GET /api/files?task_id=N
router.get('/', authenticate, async (req, res) => {
  const { task_id } = req.query;
  
  if (!task_id) return res.status(400).json({ error: 'Task ID required' });

  try {
    let sql;
    let params;

    if (req.user.role === 'admin') {
      sql = 'SELECT id, task_id, uploader_id, original_name, size, mime, created_at FROM files WHERE task_id = $1 ORDER BY created_at DESC';
      params = [task_id];
    } else {
      sql = `
        SELECT f.id, f.task_id, f.uploader_id, f.original_name, f.size, f.mime, f.created_at 
        FROM files f 
        INNER JOIN task_assignees ta ON ta.task_id = f.task_id 
        WHERE f.task_id = $1 AND ta.user_id = $2
        ORDER BY f.created_at DESC`;
      params = [task_id, req.user.id];
    }

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id/download
router.get('/:id/download', authenticate, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  
  try {
    const result = await query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) return res.status(404).send('File not found');
    
    const fileMeta = result.rows[0];
    
    // Access check
    let hasAccess = false;
    if (req.user.role === 'admin') {
      hasAccess = true;
    } else {
      const assigneeCheck = await query('SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2', [fileMeta.task_id, req.user.id]);
      hasAccess = assigneeCheck.rows.length > 0;
    }
    
    if (!hasAccess) return res.status(403).send('Forbidden');

    const filePath = path.join(uploadDir, fileMeta.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).send('Physical file missing');

    res.download(filePath, fileMeta.original_name, (err) => {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;