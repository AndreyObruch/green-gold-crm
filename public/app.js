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

async function loadTasks() {
  try {
    const res = await fetch(API + '/tasks', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const tasks = await res.json();
    const list = document.getElementById('task-list');
    if (!Array.isArray(tasks)) { list.innerHTML = ''; return; }
    list.innerHTML = tasks.map(function(t) {
      return '<li><b>' + t.title + '</b> [' + t.status + ']<br>' + (t.description || '') + '</li>';
    }).join('');
  } catch (e) {
    console.error('loadTasks error', e);
  }
}

async function createTask() {
  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-desc').value;
  try {
    const res = await fetch(API + '/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ title: title, description: description, assignee_id: 1 })
    });
    if (res.ok) {
      document.getElementById('task-title').value = '';
      document.getElementById('task-desc').value = '';
      loadTasks();
    }
  } catch (e) {
    console.error('createTask error', e);
  }
}

if (token) { showDashboard(); } else { showLogin(); }