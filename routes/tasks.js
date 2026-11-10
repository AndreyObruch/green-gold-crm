const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/', auth, (req, res) => {
  let query = 'SELECT * FROM tasks';
  let params = [];
  if (req.user.role !== 'admin') {
    query += ' WHERE assignee_id = ?';
    params.push(req.user.id);
  }
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { title, description, assignee_id } = req.body;
  db.run('INSERT INTO tasks (title, description, assignee_id, creator_id) VALUES (?, ?, ?, ?)',
    [title, description, assignee_id, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

router.patch('/:id', auth, (req, res) => {
  const { status, assignee_id } = req.body;
  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (assignee_id && req.user.role === 'admin') { updates.push('assignee_id = ?'); params.push(assignee_id); }
  
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  
  params.push(req.params.id);
  db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

module.exports = router;