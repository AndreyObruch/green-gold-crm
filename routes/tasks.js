const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const router = express.Router();

const ALLOWED_STATUS = ['new', 'in_progress', 'done'];

router.get('/', auth, (req, res) => {
  let query = 'SELECT t.*, u.username AS assignee_username, c.username AS creator_username FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users c ON t.creator_id = c.id';
  let params = [];
  if (req.user.role !== 'admin') {
    query += ' WHERE t.assignee_id = ?';
    params.push(req.user.id);
  }
  query += ' ORDER BY t.created_at DESC';
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { title, description, assignee_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  db.run('INSERT INTO tasks (title, description, assignee_id, creator_id) VALUES (?, ?, ?, ?)',
    [String(title).trim(), description || null, assignee_id || null, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

router.patch('/:id', auth, (req, res) => {
  const { status, assignee_id } = req.body;
  if (status && !ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (assignee_id && req.user.role === 'admin') { updates.push('assignee_id = ?'); params.push(assignee_id); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  if (req.user.role === 'admin') {
    params.push(req.params.id);
    db.run('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = ?', params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Task not found' });
      res.json({ updated: this.changes });
    });
  } else {
    // исполнитель меняет только свои назначенные задачи
    params.push(req.params.id, req.user.id);
    db.run('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = ? AND assignee_id = ?', params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(403).json({ error: 'Access denied' });
      res.json({ updated: this.changes });
    });
  }
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  db.run('DELETE FROM tasks WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

module.exports = router;