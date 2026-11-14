const express = require('express');
const { query, pool } = require('../db/pg-db');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

// GET /api/messages?task_id=N
router.get('/', authenticate, async (req, res) => {
  const taskId = parseInt(req.query.task_id, 10);
  
  if (!taskId) return res.status(400).json({ error: 'Task ID required' });

  try {
    let sql;
    let params;

    if (req.user.role === 'admin') {
      sql = `
        SELECT m.*, u.username AS author_username,
          (SELECT string_agg(f.id::text, ', ') FROM message_files mf JOIN files f ON f.id = mf.file_id WHERE mf.message_id = m.id) AS file_ids,
          (SELECT string_agg(f.original_name, ' | ') FROM message_files mf JOIN files f ON f.id = mf.file_id WHERE mf.message_id = m.id) AS file_names
        FROM messages m
        LEFT JOIN users u ON u.id = m.user_id
        WHERE m.task_id = $1
        ORDER BY m.created_at ASC, m.id ASC`;
      params = [taskId];
    } else {
      sql = `
        SELECT m.*, u.username AS author_username,
          (SELECT string_agg(f.id::text, ', ') FROM message_files mf JOIN files f ON f.id = mf.file_id WHERE mf.message_id = m.id) AS file_ids,
          (SELECT string_agg(f.original_name, ' | ') FROM message_files mf JOIN files f ON f.id = mf.file_id WHERE mf.message_id = m.id) AS file_names
        FROM messages m
        LEFT JOIN users u ON u.id = m.user_id
        INNER JOIN task_assignees ta ON ta.task_id = m.task_id AND ta.user_id = $2
        WHERE m.task_id = $1
        ORDER BY m.created_at ASC, m.id ASC`;
      params = [taskId, req.user.id];
    }

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messages
router.post('/', authenticate, async (req, res) => {
  const { task_id, body, file_ids } = req.body;
  const userId = req.user.id;

  if (!task_id || (!body && (!file_ids || file_ids.length === 0))) {
    return res.status(400).json({ error: 'Task ID and content required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check access
    let hasAccess = false;
    if (req.user.role === 'admin') {
      const taskCheck = await client.query('SELECT 1 FROM tasks WHERE id = $1 AND deleted = FALSE', [task_id]);
      hasAccess = taskCheck.rows.length > 0;
    } else {
      const assigneeCheck = await client.query('SELECT 1 FROM task_assignees WHERE task_id = $1 AND user_id = $2', [task_id, userId]);
      hasAccess = assigneeCheck.rows.length > 0;
    }

    if (!hasAccess) {
      throw new Error('Forbidden or Task not found');
    }

    // Insert Message
    const msgRes = await client.query(
      'INSERT INTO messages (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING id',
      [task_id, userId, body || null]
    );
    const messageId = msgRes.rows[0].id;

    // Link Files
    if (Array.isArray(file_ids) && file_ids.length > 0) {
      for (const fileId of file_ids) {
        await client.query(
          'INSERT INTO message_files (message_id, file_id) VALUES ($1, $2)',
          [messageId, fileId]
        );
      }
    }

    await client.query('COMMIT');
    
    await logAudit(userId, 'message_post', 'message', messageId, `task=${task_id} files=${file_ids ? file_ids.join(',') : ''}`);
    
    res.status(201).json({ id: messageId, message: 'Message sent' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Post message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    client.release();
  }
});

module.exports = router;