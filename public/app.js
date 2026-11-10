const API = '/api';
let token = localStorage.getItem('token');
let role = localStorage.getItem('role');

function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  if (role === 'admin') {
    document.getElementById('admin-panel').style.display = 'block';
    loadUsers();
  } else {
    document.getElementById('admin-panel').style.display = 'none';
  }
  loadTasks();
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
    const res = await fetch(API + '/users', { headers: { 'Authorization': 'Bearer ' + token } });
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

async function loadTasks() {
  try {
    const res = await fetch(API + '/tasks', { headers: { 'Authorization': 'Bearer ' + token } });
    const tasks = await res.json();
    const list = document.getElementById('task-list');
    if (!Array.isArray(tasks)) { list.innerHTML = ''; return; }
    list.innerHTML = tasks.map(function(t) {
      var p = [];
      p.push('<b>' + t.title + '</b> [' + t.status + ']');
      p.push('<br>' + (t.description || ''));
      p.push('<br><small>Исполнитель: ' + (t.assignee_username || '—') + '</small>');
      p.push('<div class="task-actions">');
      ['new', 'in_progress', 'done'].forEach(function(s) {
        p.push('<button data-act="status" data-val="' + s + '" data-id="' + t.id + '">' + s + '</button> ');
      });
      if (role === 'admin') {
        p.push('<button data-act="delete" data-id="' + t.id + '">Удалить</button>');
      }
      p.push('</div>');
      return '<li>' + p.join('') + '</li>';
    }).join('');
  } catch (e) { console.error('loadTasks', e); }
}

async function createTask() {
  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-desc').value;
  const assigneeRaw = document.getElementById('task-assignee').value;
  const assigneeId = assigneeRaw ? parseInt(assigneeRaw, 10) : null;
  try {
    const res = await fetch(API + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ title: title, description: description, assignee_id: assigneeId })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('task-title').value = '';
      document.getElementById('task-desc').value = '';
      loadTasks();
    } else {
      alert(data.error);
    }
  } catch (e) { console.error('createTask', e); }
}

document.getElementById('task-list').addEventListener('click', async function(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'status') {
      const r = await fetch(API + '/tasks/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ status: btn.dataset.val })
      });
      if (!r.ok) { const d = await r.json(); alert(d.error); return; }
    } else if (act === 'delete') {
      if (!confirm('Удалить задачу?')) return;
      await fetch(API + '/tasks/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    }
    loadTasks();
  } catch (err) { console.error('action', err); }
});

if (token) { showDashboard(); } else { showLogin(); }