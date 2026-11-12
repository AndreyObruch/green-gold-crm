const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'db', 'crm.db');
const outRoot = path.join(__dirname, 'exports');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function csvValue(value) {
  if (value === null || value === undefined) return '';

  let s;
  if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }

  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }

  return s;
}

function csvText(rows, columns) {
  const lines = [columns.map(csvValue).join(',')];

  for (const row of rows) {
    lines.push(columns.map(column => csvValue(row[column])).join(','));
  }

  return lines.join('\r\n');
}

function writeCsv(filePath, rows, columns) {
  fs.writeFileSync(filePath, '\uFEFF' + csvText(rows, columns) + '\r\n', 'utf8');
  return filePath;
}

function section(title, columns, rows) {
  return '=== ' + title + ' ===\r\n' + csvText(rows, columns) + '\r\n\r\n';
}

function formatBytes(size) {
  const n = Number(size || 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function truncate(value, max) {
  const s = String(value || '').replace(/\r?\n/g, ' ');
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
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

  console.log('usage: node export-task-csv.js <task_id>');
}

async function exportTask(id) {
  const taskRows = await all(
    'SELECT t.*, cu.username AS creator_username ' +
    'FROM tasks t ' +
    'LEFT JOIN users cu ON cu.id = t.creator_id ' +
    'WHERE t.id = ?',
    [id]
  );

  if (!taskRows.length) {
    throw new Error('Task not found: ' + id);
  }

  const task = taskRows[0];

  const assignees = await all(
    'SELECT ta.user_id, u.username, u.role, ta.assigned_by, au.username AS assigned_by_username, ta.assigned_at ' +
    'FROM task_assignees ta ' +
    'JOIN users u ON u.id = ta.user_id ' +
    'LEFT JOIN users au ON au.id = ta.assigned_by ' +
    'WHERE ta.task_id = ? ' +
    'ORDER BY u.username',
    [id]
  );

  const rawMessages = await all(
    'SELECT m.id, m.created_at, m.user_id, m.body, m.file_id AS legacy_file_id, ' +
    'COALESCE(u.username, "#" || m.user_id) AS author_username ' +
    'FROM messages m ' +
    'LEFT JOIN users u ON u.id = m.user_id ' +
    'WHERE m.task_id = ? ' +
    'ORDER BY m.created_at ASC, m.id ASC',
    [id]
  );

  const messageIds = rawMessages.map(m => m.id).filter(Boolean);
  const messageFilesMap = new Map();

  if (messageIds.length) {
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = await all(
      'SELECT mf.message_id, f.id, f.original_name ' +
      'FROM message_files mf ' +
      'JOIN files f ON f.id = mf.file_id ' +
      'WHERE mf.message_id IN (' + placeholders + ') ' +
      'ORDER BY mf.message_id, f.id',
      messageIds
    );

    rows.forEach(r => {
      if (!messageFilesMap.has(r.message_id)) messageFilesMap.set(r.message_id, []);
      messageFilesMap.get(r.message_id).push(r);
    });
  }

  const messages = rawMessages.map(m => {
    const files = messageFilesMap.get(m.id) || [];
    return {
      id: m.id,
      created_at: m.created_at,
      author_username: m.author_username,
      user_id: m.user_id,
      body: m.body || '',
      legacy_file_id: m.legacy_file_id,
      file_ids: files.map(f => f.id).join(', '),
      file_names: files.map(f => f.original_name).join(' | ')
    };
  });

  const rawFiles = await all(
    'SELECT f.*, COALESCE(u.username, "#" || f.uploader_id) AS uploader_username ' +
    'FROM files f ' +
    'LEFT JOIN users u ON u.id = f.uploader_id ' +
    'WHERE f.task_id = ? ' +
    'ORDER BY f.id',
    [id]
  );

  const fileMessagesRows = await all(
    'SELECT mf.file_id, mf.message_id ' +
    'FROM message_files mf ' +
    'JOIN files f ON f.id = mf.file_id ' +
    'WHERE f.task_id = ? ' +
    'ORDER BY mf.file_id, mf.message_id',
    [id]
  );

  const fileMessagesMap = new Map();
  fileMessagesRows.forEach(r => {
    if (!fileMessagesMap.has(r.file_id)) fileMessagesMap.set(r.file_id, []);
    fileMessagesMap.get(r.file_id).push(r.message_id);
  });

  const files = rawFiles.map(f => ({
    id: f.id,
    original_name: f.original_name,
    size: f.size,
    size_readable: formatBytes(f.size),
    mime: f.mime || '',
    uploader_id: f.uploader_id,
    uploader_username: f.uploader_username,
    created_at: f.created_at,
    stored_name: f.stored_name,
    sha256: f.sha256,
    attached_message_ids: (fileMessagesMap.get(f.id) || []).join(', ')
  }));

  const audit = await all(
    'SELECT a.*, COALESCE(a.username, "#" || a.user_id) AS actor ' +
    'FROM audit_log a ' +
    'WHERE (a.entity = "task" AND a.entity_id = ?) ' +
    'OR (a.entity = "message" AND a.entity_id IN (SELECT id FROM messages WHERE task_id = ?)) ' +
    'OR (a.entity = "file" AND a.entity_id IN (SELECT id FROM files WHERE task_id = ?)) ' +
    'ORDER BY a.created_at ASC, a.id ASC',
    [id, id, id]
  );

  const messagesById = new Map(messages.map(m => [m.id, m]));
  const filesById = new Map(files.map(f => [f.id, f]));

  const timeline = [];

  assignees.forEach(a => {
    timeline.push({
      time: a.assigned_at,
      actor: a.assigned_by_username || 'system',
      action: 'assigned',
      object: 'user #' + a.user_id + ' ' + a.username,
      details: 'task #' + id + ' role=' + a.role
    });
  });

  audit.forEach(a => {
    let extra = '';

    if (a.entity === 'message' && messagesById.has(a.entity_id)) {
      const m = messagesById.get(a.entity_id);
      extra = 'body=' + truncate(m.body, 160);
      if (m.file_names) extra += ' files=' + m.file_names;
    }

    if (a.entity === 'file' && filesById.has(a.entity_id)) {
      const f = filesById.get(a.entity_id);
      extra = 'name=' + f.original_name + ' size=' + f.size_readable;
    }

    if (a.entity === 'task') {
      extra = 'title=' + truncate(task.title, 100) + ' status=' + task.status + (task.deleted ? ' archived=yes' : ' archived=no');
    }

    timeline.push({
      time: a.created_at,
      actor: a.actor,
      action: a.action,
      object: a.entity + ' #' + a.entity_id,
      details: [a.detail, extra].filter(Boolean).join(' | ')
    });
  });

  timeline.sort((x, y) => {
    const tc = String(x.time || '').localeCompare(String(y.time || ''));
    if (tc !== 0) return tc;
    return String(x.action || '').localeCompare(String(y.action || ''));
  });

  const taskRow = {
    id: task.id,
    title: task.title || '',
    description: task.description || '',
    status: task.status || '',
    deleted: task.deleted ? 'yes' : 'no',
    creator_username: task.creator_username || ('#' + task.creator_id),
    created_at: task.created_at,
    legacy_assignee_id: task.assignee_id === null || task.assignee_id === undefined ? '' : task.assignee_id,
    assignee_usernames: assignees.map(a => a.username).join(', '),
    messages_count: messages.length,
    files_count: files.length,
    last_activity: timeline.length ? timeline[timeline.length - 1].time : task.created_at
  };

  if (!fs.existsSync(outRoot)) {
    fs.mkdirSync(outRoot, { recursive: true });
  }

  const dir = path.join(outRoot, 'task_' + id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const written = [];

  written.push(writeCsv(path.join(dir, 'task.csv'), [taskRow], Object.keys(taskRow)));

  written.push(writeCsv(
    path.join(dir, 'assignees.csv'),
    assignees.map(a => ({
      user_id: a.user_id,
      username: a.username,
      role: a.role,
      assigned_at: a.assigned_at,
      assigned_by: a.assigned_by_username || (a.assigned_by ? '#' + a.assigned_by : '')
    })),
    ['user_id', 'username', 'role', 'assigned_at', 'assigned_by']
  ));

  written.push(writeCsv(
    path.join(dir, 'messages.csv'),
    messages,
    ['id', 'created_at', 'author_username', 'body', 'file_ids', 'file_names', 'legacy_file_id']
  ));

  written.push(writeCsv(
    path.join(dir, 'files.csv'),
    files,
    ['id', 'original_name', 'size_readable', 'size', 'mime', 'uploader_username', 'created_at', 'attached_message_ids', 'stored_name', 'sha256']
  ));

  written.push(writeCsv(
    path.join(dir, 'audit.csv'),
    audit.map(a => ({
      id: a.id,
      created_at: a.created_at,
      actor: a.actor,
      action: a.action,
      entity: a.entity,
      entity_id: a.entity_id,
      detail: a.detail || ''
    })),
    ['id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'detail']
  ));

  written.push(writeCsv(
    path.join(dir, 'timeline.csv'),
    timeline,
    ['time', 'actor', 'action', 'object', 'details']
  ));

  const taskKv = Object.entries(taskRow).map(([field, value]) => ({ field, value }));

  const fullSections = [
    section('TASK', ['field', 'value'], taskKv),
    section('ASSIGNEES', ['user_id', 'username', 'role', 'assigned_at', 'assigned_by'], assignees.map(a => ({
      user_id: a.user_id,
      username: a.username,
      role: a.role,
      assigned_at: a.assigned_at,
      assigned_by: a.assigned_by_username || (a.assigned_by ? '#' + a.assigned_by : '')
    }))),
    section('MESSAGES', ['id', 'created_at', 'author_username', 'body', 'file_ids', 'file_names'], messages),
    section('FILES', ['id', 'original_name', 'size_readable', 'mime', 'uploader_username', 'created_at', 'attached_message_ids'], files),
    section('AUDIT', ['id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'detail'], audit.map(a => ({
      id: a.id,
      created_at: a.created_at,
      actor: a.actor,
      action: a.action,
      entity: a.entity,
      entity_id: a.entity_id,
      detail: a.detail || ''
    }))),
    section('TIMELINE', ['time', 'actor', 'action', 'object', 'details'], timeline)
  ];

  const fullPath = path.join(dir, 'task_full.csv');
  fs.writeFileSync(fullPath, '\uFEFF' + fullSections.join(''), 'utf8');
  written.push(fullPath);

  console.log('Task CSV exported to: ' + dir);
  written.forEach(file => console.log(file));
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

    await exportTask(id);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();