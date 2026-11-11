const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const db = new sqlite3.Database(dbPath);

const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');

function logMigration(label, err) {
  if (err && !/duplicate column/i.test(err.message)) {
    console.error('Migration error (' + label + '):', err.message);
  } else {
    console.log(label + ' ready');
  }
}

db.exec(initSql, (err) => {
  if (err) {
    console.error('DB init error:', err);
    return;
  }

  console.log('Database initialized');

  db.serialize(() => {
    db.run(
      'ALTER TABLE tasks ADD COLUMN deleted INTEGER DEFAULT 0',
      function (e) {
        logMigration('Soft-delete column', e);
      }
    );

    db.run(
      'CREATE TABLE IF NOT EXISTS audit_log (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'user_id INTEGER, ' +
      'username TEXT, ' +
      'action TEXT, ' +
      'entity TEXT, ' +
      'entity_id INTEGER, ' +
      'detail TEXT, ' +
      'created_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ')',
      function (e) {
        logMigration('Audit log table', e);
      }
    );

    db.run(
      'CREATE TABLE IF NOT EXISTS files (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'task_id INTEGER, ' +
      'uploader_id INTEGER, ' +
      'original_name TEXT, ' +
      'stored_name TEXT, ' +
      'mime TEXT, ' +
      'size INTEGER, ' +
      'sha256 TEXT, ' +
      'created_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ')',
      function (e) {
        logMigration('Files table', e);
      }
    );

    db.run(
      'CREATE TABLE IF NOT EXISTS messages (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'task_id INTEGER, ' +
      'user_id INTEGER, ' +
      'body TEXT, ' +
      'file_id INTEGER, ' +
      'created_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ')',
      function (e) {
        logMigration('Messages table', e);
      }
    );

    db.run(
      'CREATE TABLE IF NOT EXISTS task_assignees (' +
      'task_id INTEGER NOT NULL, ' +
      'user_id INTEGER NOT NULL, ' +
      'assigned_by INTEGER, ' +
      'assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP, ' +
      'PRIMARY KEY (task_id, user_id)' +
      ')',
      function (e) {
        logMigration('Task assignees table', e);
      }
    );

    db.run(
      'CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id)',
      function (e) {
        logMigration('Index task_assignees_task', e);
      }
    );

    db.run(
      'CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id)',
      function (e) {
        logMigration('Index task_assignees_user', e);
      }
    );

    db.run(
      'INSERT OR IGNORE INTO task_assignees (task_id, user_id) ' +
      'SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL',
      function (e) {
        logMigration('Assignees backfill', e);
      }
    );
  });
});

module.exports = db;