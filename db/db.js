const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const db = new sqlite3.Database(dbPath);

const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
db.exec(initSql, (err) => {
  if (err) console.error('DB init error:', err);
  else console.log('Database initialized');
  db.run('ALTER TABLE tasks ADD COLUMN deleted INTEGER DEFAULT 0', (e) => {
    if (e && !/duplicate column/i.test(e.message)) console.error('Migration error (deleted):', e);
    else console.log('Soft-delete column ready');
    db.run('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, action TEXT, entity TEXT, entity_id INTEGER, detail TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)', (e2) => {
      if (e2) console.error('Migration error (audit_log):', e2);
      else console.log('Audit log table ready');
      db.run('CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, uploader_id INTEGER, original_name TEXT, stored_name TEXT, mime TEXT, size INTEGER, sha256 TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)', (e3) => {
        if (e3) console.error('Migration error (files):', e3);
        else console.log('Files table ready');
        db.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER, body TEXT, file_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)', (e4) => {
          if (e4) console.error('Migration error (messages):', e4);
          else console.log('Messages table ready');
        });
      });
    });
  });
});

module.exports = db;