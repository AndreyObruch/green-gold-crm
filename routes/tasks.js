const express = require('express');
const db = require('../db/db');
const auth = require('../middleware/auth');
const audit = require('../middleware/audit');
const router = express.Router();

const ALLOWED_STATUS = ['new', 'in_progress', 'done'];

function validAssignee(id, cb) {
  if (id === null || id === undefined || id === '') return cb(true);
  const num = parseInt(id, 10);
  if (isNaN(num)) return cb(false);
  db.get('SELECT id FROM users WHERE id = ?', [num], (err, row) => {
    if (err) return cb(false);
    cb(!!row);
  });
}

function updateDetail(body) {
  const parts = [];
  if (body.status) parts.push('status=' + body.status);
  if (body.assignee_id) parts.push('assignee=' + body.assignee_id);
  return parts.join(' ');
}

router.get('/', auth, (req, res) => {
  let query = 'SELECT t.*, u.username AS assignee_username, c.username AS creator_username FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users c ON t.creator_id = c.id WHERE t.deleted = 0';
  let params = [];
  if (req.user.role !== 'admin') {
    query += ' AND t.assignee_id = ?';
    params.push(req.user.id);
  }
  query += ' ORDER BY t.created_at DESC';
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/archive', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  db.all('SELECT t.*, u.username AS assignee_username, c.username AS creator_username FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users c ON t.creator_id = c.id WHERE t.deleted = 1 ORDER BY t.created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    audit(req.user.id, req.user.username, 'task_create_denied', 'task', null, 'not_admin');
    return res.status(403).json({ error: 'Access denied' });
  }
  const { title, description, assignee_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  validAssignee(assignee_id, function(ok) {
    if (!ok) return res.status(400).json({ error: 'Invalid assignee_id' });
    const tid = assignee_id ? parseInt(assignee_id, 10) : null;
    db.run('INSERT INTO tasks (title, description, assignee_id, creator_id, deleted) VALUES (?, ?, ?, ?, 0)',
      [String(title).trim(), description || null, tid, req.user.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        audit(req.user.id, req.user.username, 'task_create', 'task', this.lastID, String(title).trim());
        res.json({ id: this.lastID });
      }
    );
  });
});

function applyPatch(req, res, updates, params) {
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const detail = updateDetail(req.body);
  if (req.user.role === 'admin') {
    params.push(req.params.id);
    db.run('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = ? AND deleted = 0', params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Task not found' });
      audit(req.user.id, req.user.username, 'task_update', 'task', req.params.id, detail);
      res.json({ updated: this.changes });
    });
  } else {
    params.push(req.params.id, req.user.id);
    db.run('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = ? AND assignee_id = ? AND deleted = 0', params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        audit(req.user.id, req.user.username, 'task_update_denied', 'task', req.params.id, 'not_owner');
        return res.status(403).json({ error: 'Access denied' });
      }
      audit(req.user.id, req.user.username, 'task_update', 'task', req.params.id, detail);
      res.json({ updated: this.changes });
    });
  }
}

router.patch('/:id', auth, (req, res) => {
  const { status, assignee_id } = req.body;
  if (status && !ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (assignee_id && req.user.role === 'admin') {
    validAssignee(assignee_id, function(ok) {
      if (!ok) return res.status(400).json({ error: 'Invalid assignee_id' });
      updates.push('assignee_id = ?'); params.push(parseInt(assignee_id, 10));
      applyPatch(req, res, updates, params);
    });
    return;
  }
  applyPatch(req, res, updates, params);
});

router.post('/:id/restore', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    audit(req.user.id, req.user.username, 'task_restore_denied', 'task', req.params.id, 'not_admin');
    return res.status(403).json({ error: 'Access denied' });
  }
  db.run('UPDATE tasks SET deleted = 0 WHERE id = ? AND deleted = 1', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Task not found in archive' });
    audit(req.user.id, req.user.username, 'task_restore', 'task', req.params.id, 'ok');
    res.json({ restored: this.changes });
  });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    audit(req.user.id, req.user.username, 'task_delete_denied', 'task', req.params.id, 'not_admin');
    return res.status(403).json({ error: 'Access denied' });
  }
  db.run('UPDATE tasks SET deleted = 1 WHERE id = ? AND deleted = 0', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Task not found' });
    audit(req.user.id, req.user.username, 'task_delete', 'task', req.params.id, 'soft');
    res.json({ deleted: this.changes });
  });
});

module.exports = router;