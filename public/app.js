const API = '/api';
let token = null;
let role = null;

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusClass(s) {
  return ({ 'new': 'st-new', 'in_progress': 'st-prog', 'done': 'st-done' })[s] || 'st-other';
}
function statusLabel(s) {
  return ({ 'new': '\u041d\u043e\u0432\u0430\u044f', 'in_progress': '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435', 'done': '\u0413\u043e\u0442\u043e\u0432\u043e' })[s] || escapeHtml(s);
}
function fmtDate(s) {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', ' ');
}

const _rawFetch = window.fetch.bind(window);
window.fetch = async function(url, opts) {
  const isAuth = typeof url === 'string' && url.indexOf('/api/auth') !== -1;
  const liveToken = localStorage.getItem('token');
  if (!isAuth && liveToken) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + liveToken });
  }
  const res = await _rawFetch(url, opts);
  if (!isAuth && res.status === 401) { logout(); }
  return res;
};

const TABS = {
  tasks:   { panel: 'tab-tasks',     load: loadTasks },
  create:  { panel: 'admin-panel',   load: loadUsers },
  archive: { panel: 'archive-panel', load: loadArchive }
};

function switchTab(name) {
  if (!TABS[name]) name = 'tasks';
  Object.keys(TABS).forEach(function(k) {
    const p = document.getElementById(TABS[k].panel);
    if (p) p.style.display = (k === name) ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  const t = TABS[name];
  if (t && typeof t.load === 'function') t.load();
}

function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  const isAdmin = role === 'admin';
  const nc = document.getElementById('nav-create');
  const na = document.getElementById('nav-archive');
  if (nc) nc.style.display = isAdmin ? '' : 'none';
  if (na) na.style.display = isAdmin ? '' : 'none';
  switchTab('tasks');
}

async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      role = data.role;
      localStorage.setItem('token', token);
      localStorage.setItem('role', role);
      showDashboard();
    } else {
      alert(data.error);
    }
  } catch (e) {
    alert('Server unavailable');
  }
}

function logout() {
  localStorage.clear();
  token = null;
  role = null;
  showLogin();
}

async function loadUsers() {
  try {
    const res = await fetch(API + '/users');
    const users = await res.json();
    const sel = document.getElementById('task-assignee');
    sel.innerHTML = '';
    if (!Array.isArray(users)) return;
    users.forEach(function(u) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.username + ' (' + u.role + ')';
      sel.appendChild(opt);
    });
  } catch (e) { console.error('loadUsers', e); }
}

async function attachFiles(tasks) {
  await Promise.all(tasks.map(async function(t) {
    const box = document.getElementById('files-' + t.id);
    if (!box) return;
    try {
      const r = await fetch(API + '/files?task_id=' + t.id);
      const fs = await r.json();
      if (!Array.isArray(fs) || fs.length === 0) { box.remove(); return; }
      box.innerHTML = fs.map(function(f) {
        return '<button class="chip" data-act="download" data-id="' + f.id + '" data-name="' + escapeHtml(f.original_name) + '">\uD83D\uDCCE ' + escapeHtml(f.original_name) + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)</button>';
      }).join('');
    } catch (e) { box.remove(); }
  }));
}

async function loadTasks() {
  try {
    const res = await fetch(API + '/tasks');
    const tasks = await res.json();
    const list = document.getElementById('task-list');
    if (!Array.isArray(tasks)) { list.innerHTML = ''; return; }
    list.innerHTML = tasks.map(function(t) {
      var badge = '<span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span>';
      var head = '<div class="task-head"><b class="task-title-text">' + escapeHtml(t.title) + '</b>' + badge + '</div>';
      var desc = (t.description && String(t.description).trim())
        ? '<div class="task-desc">' + escapeHtml(String(t.description)).replace(/\n/g, '<br>') + '</div>'
        : '';
      var mp = ['\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c: ' + escapeHtml(t.assignee_username || '\u2014')];
      if (t.creator_username) mp.push('\u0421\u043e\u0437\u0434\u0430\u043b: ' + escapeHtml(t.creator_username));
      var d = fmtDate(t.created_at); if (d) mp.push(d);
      var meta = '<div class="task-meta"><small>' + mp.join(' \u00b7 ') + '</small></div>';
      var filesBox = '<div class="task-actions" id="files-' + t.id + '"></div>';
      var acts = '<div class="task-actions">';
      ['new', 'in_progress', 'done'].forEach(function(s) {
        acts += '<button class="chip chip-' + statusClass(s) + '" data-act="status" data-val="' + s + '" data-id="' + t.id + '">' + statusLabel(s) + '</button> ';
      });
      if (role === 'admin') {
        acts += '<button class="chip chip-del" data-act="delete" data-id="' + t.id + '">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button>';
      }
      acts += '</div>';
      return '<li class="task-card">' + head + desc + meta + filesBox + acts + '</li>';
    }).join('');
    attachFiles(tasks);
  } catch (e) { console.error('loadTasks', e); }
}

async function loadArchive() {
  try {
    const res = await fetch(API + '/tasks/archive');
    const tasks = await res.json();
    const list = document.getElementById('archive-list');
    if (!Array.isArray(tasks)) { list.innerHTML = ''; return; }
    list.innerHTML = tasks.map(function(t) {
      var badge = '<span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span>';
      var head = '<div class="task-head"><b class="task-title-text">' + escapeHtml(t.title) + '</b>' + badge + '</div>';
      var mp = ['\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c: ' + escapeHtml(t.assignee_username || '\u2014')];
      if (t.creator_username) mp.push('\u0421\u043e\u0437\u0434\u0430\u043b: ' + escapeHtml(t.creator_username));
      var d = fmtDate(t.created_at); if (d) mp.push(d);
      var meta = '<div class="task-meta"><small>' + mp.join(' \u00b7 ') + '</small></div>';
      var acts = '<div class="task-actions"><button class="chip chip-restore" data-act="restore" data-id="' + t.id + '">\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c</button></div>';
      return '<li class="task-card">' + head + meta + acts + '</li>';
    }).join('');
  } catch (e) { console.error('loadArchive', e); }
}

async function downloadFile(id, name) {
  try {
    const r = await fetch(API + '/files/' + id + '/download');
    if (!r.ok) { const d = await r.json().catch(function() { return {}; }); alert(d.error || 'Download failed'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } catch (e) { console.error('download', e); }
}

async function createTask() {
  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-desc').value;
  const assigneeRaw = document.getElementById('task-assignee').value;
  const assigneeId = assigneeRaw ? parseInt(assigneeRaw, 10) : null;
  const fileInput = document.getElementById('task-files');
  const sel = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (sel.length > 3) { alert('\u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 3 \u0444\u0430\u0439\u043b\u0430'); return; }
  for (const f of sel) { if (f.size > 10 * 1024 * 1024) { alert('\u0424\u0430\u0439\u043b > 10 \u041c\u0411: ' + f.name); return; } }
  try {
    const res = await fetch(API + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, description: description, assignee_id: assigneeId })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('task-title').value = '';
      document.getElementById('task-desc').value = '';
      if (sel.length) {
        const fd = new FormData();
        sel.forEach(function(f) { fd.append('files', f); });
        fd.append('task_id', String(data.id));
        const ur = await fetch(API + '/files', { method: 'POST', body: fd });
        if (!ur.ok) {
          const ud = await ur.json().catch(function() { return {}; });
          alert('\u0417\u0430\u0434\u0430\u0447\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0430, \u043d\u043e \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043d\u0435 \u0443\u0434\u0430\u043b\u0430\u0441\u044c: ' + (ud.error || ''));
        }
        fileInput.value = '';
      }
      switchTab('tasks');
    } else {
      alert(data.error);
    }
  } catch (e) { console.error('createTask', e); }
}

document.querySelector('.main-nav').addEventListener('click', function(e) {
  const btn = e.target.closest('.nav-btn');
  if (btn) switchTab(btn.dataset.tab);
});

document.getElementById('task-list').addEventListener('click', async function(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'download') { downloadFile(id, btn.dataset.name); return; }
  try {
    if (act === 'status') {
      const r = await fetch(API + '/tasks/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.val })
      });
      if (!r.ok) { const d = await r.json(); alert(d.error); return; }
    } else if (act === 'delete') {
      if (!confirm('\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0437\u0430\u0434\u0430\u0447\u0443?')) return;
      await fetch(API + '/tasks/' + id, { method: 'DELETE' });
    }
    loadTasks();
  } catch (err) { console.error('action', err); }
});

document.getElementById('archive-list').addEventListener('click', async function(e) {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.act !== 'restore') return;
  try {
    const r = await fetch(API + '/tasks/' + btn.dataset.id + '/restore', { method: 'POST' });
    if (!r.ok) { const d = await r.json(); alert(d.error); return; }
    loadTasks();
    loadArchive();
  } catch (err) { console.error('restore', err); }
});

// Start: always login form, no session auto-restore
localStorage.removeItem('token');
localStorage.removeItem('role');
token = null;
role = null;
showLogin();