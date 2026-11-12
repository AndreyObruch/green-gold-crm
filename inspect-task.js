const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'crm.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function printSection(title) {
  console.log('');
  console.log('=== ' + title + ' ===');
}

function formatBytes(size) {
  const n = Number(size || 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

async function listTasks() {
  const rows = await all(
    'SELECT t.id, t.title, t.status, t.deleted, cu.username AS creator_username, ' +
    '(SELECT group_concat(username, ", ") FROM (' +
      'SELECT u.username FROM task_assignees ta ' +
      'JOIN users u ON u.id = ta.user_id ' +
      'WHERE ta.task_id = t.id ORDER BY u.username' +
    ')) AS assignees ' +
    'FROM tasks t ' +
    'LEFT JOIN users cu ON cu.id = t.creator_id ' +
    'ORDER BY t.id'
  );

  if (!rows.length) {
    console.log('No tasks found.');
    return;
  }

  console.log('Available tasks:');
  rows.forEach(r => {
    console.log(
      r.id + ' | ' +
      r.status + ' | ' +
      (r.deleted ? 'archived' : 'active') + ' | ' +
      (r.assignees || '-') + ' | ' +
      r.title
    );
  });
  console.log('usage: node inspect-task.js <task_id>');
}

async function showTask(id) {
  const taskRows = await all(
    'SELECT t.*, cu.username AS creator_username ' +
    'FROM tasks t ' +
    'LEFT JOIN users cu ON cu.id = t.creator_id ' +
    'WHERE t.id = ?',
    [id]
  );

  if (!taskRows.length) {
    console.log('Task not found: ' + id);
    process.exitCode = 1;
    return;
  }

  const t = taskRows[0];

  printSection('TASK');
  console.log('id: ' + t.id);
  console.log('title: ' + (t.title || ''));
  console.log('description: ' + (t.description || ''));
  console.log('status: ' + t.status);
  console.log('deleted: ' + (t.deleted ? 'yes (archive)' : 'no'));
  console.log('creator: ' + (t.creator_username || ('#' + t.creator_id)));
  console.log('created_at: ' + t.created_at);
  console.log('legacy_assignee_id: ' + (t.assignee_id === null || t.assignee_id === undefined ? '-' : t.assignee_id));

  const assignees = await all(
    'SELECT ta.user_id, u.username, u.role, ta.assigned_by, au.username AS assigned_by_username, ta.assigned_at ' +
    'FROM task_assignees ta ' +
    'JOIN users u ON u.id = ta.user_id ' +
    'LEFT JOIN users au ON au.id = ta.assigned_by ' +
    'WHERE ta.task_id = ? ' +
    'ORDER BY u.username',
    [id]
  );

  printSection('ASSIGNEES');
  if (!assignees.length) {
    console.log('none');
  } else {
    assignees.forEach(a => {
      console.log(
        '#' + a.user_id + ' ' + a.username + ' (' + a.role + ') | ' +
        'assigned_at: ' + a.assigned_at + ' | ' +
        'assigned_by: ' + (a.assigned_by_username || (a.assigned_by ? '#' + a.assigned_by : '-'))
      );
    });
  }

  const messages = await all(
    'SELECT m.*, u.username AS author_username ' +
    'FROM messages m ' +
    'LEFT JOIN users u ON u.id = m.user_id ' +
    'WHERE m.task_id = ? ' +
    'ORDER BY m.created_at ASC, m.id ASC',
    [id]
  );

  const messageIds = messages.map(m => m.id).filter(Boolean);
  const filesByMessage = new Map();

  if (messageIds.length) {
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = await all(
      'SELECT mf.message_id, f.id, f.original_name, f.size, f.mime ' +
      'FROM message_files mf ' +
      'JOIN files f ON f.id = mf.file_id ' +
      'WHERE mf.message_id IN (' + placeholders + ') ' +
      'ORDER BY mf.message_id, f.id',
      messageIds
    );

    rows.forEach(r => {
      if (!filesByMessage.has(r.message_id)) filesByMessage.set(r.message_id, []);
      filesByMessage.get(r.message_id).push(r);
    });
  }

  printSection('CHAT MESSAGES');
  if (!messages.length) {
    console.log('none');
  } else {
    messages.forEach(m => {
      console.log('message #' + m.id + ' | ' + m.created_at + ' | ' + (m.author_username || ('#' + m.user_id)));
      if (m.body) console.log('body: ' + m.body);

      const files = filesByMessage.get(m.id) || [];
      if (files.length) {
        files.forEach(f => {
          console.log('file: #' + f.id + ' ' + f.original_name + ' (' + formatBytes(f.size) + ', ' + (f.mime || '-') + ')');
        });
      } else if (m.file_id) {
        console.log('legacy file_id: #' + m.file_id);
      }
    });
  }

  const files = await all(
    'SELECT f.*, u.username AS uploader_username ' +
    'FROM files f ' +
    'LEFT JOIN users u ON u.id = f.uploader_id ' +
    'WHERE f.task_id = ? ' +
    'ORDER BY f.id',
    [id]
  );

  printSection('FILES');
  if (!files.length) {
    console.log('none');
  } else {
    files.forEach(f => {
      console.log(
        'file #' + f.id + ' | ' + f.original_name + ' | ' + formatBytes(f.size) + ' | ' +
        (f.mime || '-') + ' | uploader: ' + (f.uploader_username || ('#' + f.uploader_id)) + ' | ' +
        f.created_at + ' | stored: ' + f.stored_name + ' | sha256: ' + f.sha256
      );
    });
  }

  const fileIds = files.map(f => f.id).filter(Boolean);

  const taskAudit = await all(
    'SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id',
    ['task', id]
  );

  const messageAudit = messageIds.length
    ? await all(
        'SELECT * FROM audit_log WHERE entity = ? AND entity_id IN (' + messageIds.map(() => '?').join(',') + ') ORDER BY id',
        ['message'].concat(messageIds)
      )
    : [];

  const fileAudit = fileIds.length
    ? await all(
        'SELECT * FROM audit_log WHERE entity = ? AND entity_id IN (' + fileIds.map(() => '?').join(',') + ') ORDER BY id',
        ['file'].concat(fileIds)
      )
    : [];

  const audit = [...taskAudit, ...messageAudit, ...fileAudit].sort((a, b) => a.id - b.id);

  printSection('AUDIT LOG');
  if (!audit.length) {
    console.log('none');
  } else {
    audit.forEach(a => {
      console.log(
        '#' + a.id + ' | ' + a.created_at + ' | ' + (a.username || ('#' + a.user_id)) + ' | ' +
        a.action + ' | ' + a.entity + ' #' + a.entity_id + ' | ' + (a.detail || '')
      );
    });
  }
}

async function main() {
  try {
    const arg = process.argv[2];

    if (!arg) {
      await listTasks();
      return;
    }

    const id = parseInt(arg, 10);
    if (!Number.isInteger(id) || id <= 0) {
      console.log('Invalid task id: ' + arg);
      process.exitCode = 1;
      return;
    }

    await showTask(id);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();