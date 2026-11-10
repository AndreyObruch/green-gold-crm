const API = '/api';
let token = localStorage.getItem('token');
let role = localStorage.getItem('role');

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    if (role === 'admin') document.getElementById('admin-panel').style.display = 'block';
    loadTasks();
}

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
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
}

function logout() {
    localStorage.clear();
    token = null;
    role = null;
    showLogin();
}

async function loadTasks() {
    const res = await fetch(`${API}/tasks`, { headers: { 'Authorization': `Bearer ${token}` } });
    const tasks = await res.json();
    const list = document