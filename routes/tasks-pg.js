const express = require('express');
const { query } = require('../db/pg-db');
const { authenticate, authorizeRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

// GET /api/tasks
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    let sql;
    let params;

    if (isAdmin) {
      // Admin sees all non-deleted tasks
      sql = `
        SELECT t.*, cu.username AS creator_username,
          (SELECT string_agg(u.username, ', ') FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignee_usernames
        FROM tasks t
        LEFT JOIN users cu ON cu.id = t.creator_id
        WHERE t.deleted = FALSE
        ORDER BY t.created_at DESC`;
      params = [];
    } else {
      // Executor sees only assigned tasks
      sql = `
        SELECT t.*, cu.username AS creator_username,
          (SELECT string_agg(u.username, ', ') FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignee_usernames
        FROM tasks t
        LEFT JOIN users cu ON cu.id = t.creator_id
        INNER JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
        WHERE t.deleted = FALSE
        ORDER BY t.created_at DESC`;
      params = [userId];
    }

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks (Admin only)
router.post('/', authenticate, authorizeRole(['admin']), async (req, res) => {
  const { title, description, status, assignee_ids } = req.body;
  
  if (!title) return res.status(400).json({ error: 'Title required' });

  try {
    const client = await require('../db/pg-db').pool.connect();
    try {
      await client.query('BEGIN');
      
      // Insert Task
      const taskRes = await client.query(
        'INSERT INTO tasks (title, description, status, creator_id, deleted) VALUES ($1, $2, $3, $4, FALSE) RETURNING id',
        [title, description || '', status || 'new', req.user.id]
      );
      const taskId = taskRes.rows[0].id;

      // Assign Users
      if (Array.isArray(assignee_ids)) {
        for (const uid of assignee_ids) {
          await client.query(
            'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1, $2, $3)',
            [taskId, uid, req.user.id]
          );
        }
      }

      await client.query('COMMIT');
      
      // Audit Log
      await logAudit(req.user.id, 'task_create', 'task', taskId, `assignees=${assignee_ids ? assignee_ids.join(',') : ''}`);

      res.status(201).json({ id: taskId, message: 'Task created' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', authenticate, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const { title, description, status, assignee_ids } = req.body;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  try {
    // Check existence and permissions
    const checkSql = `
      SELECT t.*, 
        EXISTS(SELECT 1 FROM task_assignees WHERE task_id = t.id AND user_id = $2) as is_assigned
      FROM tasks t WHERE t.id = $1 AND t.deleted = FALSE`;
    
    const checkRes = await query(checkSql, [taskId, userId]);
    if (checkRes.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    
    const task = checkRes.rows[0];

    if (!isAdmin && !task.is_assigned) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (isAdmin) {
      if (title !== undefined) { updates.push(`title = $${paramIndex++}`); values.push(title); }
      if (description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(description); }
      if (status !== undefined) { updates.push(`status = $${paramIndex++}`); values.push(status); }
    } else {
      // Executor can only update status
      if (status !== undefined) { updates.push(`status = $${paramIndex++}`); values.push(status); }
    }

    if (updates.length > 0) {
      values.push(taskId);
      const sql = `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
      await query(sql, values);
      
      // Handle Assignees (Admin only)
      if (isAdmin && Array.isArray(assignee_ids)) {
        await query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
        for (const uid of assignee_ids) {
          await query('INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1, $2, $3)', [taskId, uid, userId]);
        }
      }

      await logAudit(userId, 'task_update', 'task', taskId, `fields=${Object.keys(req.body).join(',')}`);
      res.json({ message: 'Updated' });
    } else {
      res.json({ message: 'No changes' });
    }

  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id (Soft Delete, Admin only)
router.delete('/:id', authenticate, authorizeRole(['admin']), async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  try {
    await query('UPDATE tasks SET deleted = TRUE WHERE id = $1', [taskId]);
    await logAudit(req.user.id, 'task_delete', 'task', taskId, '');
    res.json({ message: 'Archived' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Failed to archive task' });
  }
});

module.exports = router;