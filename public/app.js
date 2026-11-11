const API = '/api';
let token = null;
let role = null;
let allTasks = [];
let selected = new Set();
let undoStack = [];
let currentView = 'all';
let searchTerm = '';
let filterStatus = 'all';
let sortBy = 'date_desc';

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function statusClass(s) { return ({ 'new': 'st-new', 'in_progress': 'st-prog', 'done': 'st-done' })[s] || 'st-other'; }
function statusLabel(s) { return ({ 'new': 'Новая', 'in_progress': 'В работе', 'done': 'Готово' })[s] || escapeHtml(s); }
function fmtDate(s) { if (!s) return ''; return String(s).slice(0, 16).replace('T', ' '); }

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
  tasks: { panel: 'tab-tasks', load: loadTasks },
  create: { panel: 'admin-panel', load: loadUsers },
  archive: { panel: 'archive-panel', load: loadArchive }
};

function switchTab(name) {
  if (!TABS[name]) name = 'tasks';
  Object.keys(TABS).forEach(k => {
    const p = document.getElementById(TABS[k].panel);
    if (p) p.style.display = (k === name) ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
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
  document.getElementById('nav-create').style.display = isAdmin ? '' : 'none';
  document.getElementById('nav-archive').style.display = isAdmin ? '' : 'none';
  switchTab('tasks');
}

async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token; role = data.role;
      localStorage.setItem('token', token); localStorage.setItem('role', role);
      showDashboard();
    } else { alert(data.error); }
  } catch (e) { alert('Server unavailable'); }
}
function logout() {
  localStorage.clear(); token = null; role = null;
  allTasks = []; selected.clear(); undoStack = [];
  showLogin();
}

async function loadUsers() {
  try {
    const res = await fetch(API + '/users');
    const users = await res.json();
    const sel = document.getElementById('task-assignee');
    sel.innerHTML = '';
    if (!Array.isArray(users)) return;
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.username + ' (' + u.role + ')';
      sel.appendChild(opt);
    });
  } catch (e) { console.error('loadUsers', e); }
}

function applyView(tasks) {
  let out = tasks.slice();
  if (currentView === 'mine') out = out.filter(t => t.assignee_username === localStorage.getItem('username'));
  if (currentView === 'active') out = out.filter(t => t.status !== 'done');
  if (filterStatus !== 'all') out = out.filter(t => t.status === filterStatus);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    out = out.filter(t => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q) || (t.assignee_username || '').toLowerCase().includes(q));
  }
  if (sortBy === 'date_desc') out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (sortBy === 'date_asc') out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (sortBy === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru'));
  if (sortBy === 'status') out.sort((a, b) => String(a.status).localeCompare(String(b.status)));
  return out;
}

function renderCounters(tasks) {
  const c = { new: 0, in_progress: 0, done: 0 };
  tasks.forEach(t => { if (c[t.status] !== undefined) c[t.status]++; });
  const el = document.getElementById('counters');
  if (el) el.innerHTML =
    '<span class="view-chip st-new">Новые: ' + c.new + '</span>' +
    '<span class="view-chip st-prog">В работе: ' + c.in_progress + '</span>' +
    '<span class="view-chip st-done">Готово: ' + c.done + '</span>';
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const view = applyView(allTasks);
  renderCounters(allTasks);
  if (view.length === 0) {
    list.innerHTML = '<li class="empty-state">Нет задач под текущий фильтр</li>';
    return;
  }
  list.innerHTML = view.map(t => {
    const badge = '<span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span>';
    const chk = role === 'admin' ? '<input type="checkbox" class="task-check" data-id="' + t.id + '"' + (selected.has(t.id) ? ' checked' : '') + '>' : '';
    const head = '<div class="task-head">' + chk + '<b class="task-title-text" data-act="open" data-id="' + t.id + '" style="cursor:pointer">' + escapeHtml(t.title) + '</b>' + badge + '</div>';
    const desc = (t.description && String(t.description).trim()) ? '<div class="task-desc">' + escapeHtml(String(t.description)).replace(/\n/g, '<br>') + '</div>' : '';
    const mp = ['Исполнитель: ' + escapeHtml(t.assignee_username || '—')];
    if (t.creator_username) mp.push('Создал: ' + escapeHtml(t.creator_username));
    const d = fmtDate(t.created_at); if (d) mp.push(d);
    const meta = '<div class="task-meta"><small>' + mp.join(' · ') + '</small></div>';
    const filesBox = '<div class="task-actions" id="files-' + t.id + '"></div>';
    let acts = '<div class="task-actions">';
    ['new', 'in_progress', 'done'].forEach(s => {
      acts += '<button class="chip chip-' + statusClass(s) + '" data-act="status" data-val="' + s + '" data-id="' + t.id + '">' + statusLabel(s) + '</button> ';
    });
    if (role === 'admin') acts += '<button class="chip chip-del" data-act="delete" data-id="' + t.id + '">Удалить</button>';
    acts += '</div>';
    return '<li class="task-card' + (selected.has(t.id) ? ' selected' : '') + '" data-task="' + t.id + '">' + head + desc + meta + filesBox + acts + '</li>';
  }).join('');
  attachFiles(view);
  updateBulkBar();
}

async function loadTasks() {
  try {
    const res = await fetch(API + '/tasks');
    const tasks = await res.json();
    allTasks = Array.isArray(tasks) ? tasks : [];
    selected.clear();
    renderTasks();
  } catch (e) { console.error('loadTasks', e); }
}

async function attachFiles(tasks) {
  await Promise.all(tasks.map(async t => {
    const box = document.getElementById('files-' + t.id);
    if (!box) return;
    try {
      const r = await fetch(API + '/files?task_id=' + t.id);
      const fs = await r.json();
      if (!Array.isArray(fs) || fs.length === 0) { box.remove(); return; }
      box.innerHTML = fs.map(f =>
        '<button class="chip" data-act="download" data-id="' + f.id + '" data-name="' + escapeHtml(f.original_name) + '">📎 ' + escapeHtml(f.original_name) + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)</button>'
      ).join('');
    } catch (e) { box.remove(); }
  }));
}

async function loadArchive() {
  try {
    const res = await fetch(API + '/tasks/archive');
    const tasks = await res.json();
    const list = document.getElementById('archive-list');
    if (!Array.isArray(tasks)) { list.innerHTML = ''; return; }
    list.innerHTML = tasks.map(t => {
      const badge = '<span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span>';
      const head = '<div class="task-head"><b class="task-title-text">' + escapeHtml(t.title) + '</b>' + badge + '</div>';
      const mp = ['Исполнитель: ' + escapeHtml(t.assignee_username || '—')];
      if (t.creator_username) mp.push('Создал: ' + escapeHtml(t.creator_username));
      const d = fmtDate(t.created_at); if (d) mp.push(d);
      const meta = '<div class="task-meta"><small>' + mp.join(' · ') + '</small></div>';
      const acts = '<div class="task-actions"><button class="chip chip-restore" data-act="restore" data-id="' + t.id + '">Восстановить</button></div>';
      return '<li class="task-card">' + head + meta + acts + '</li>';
    }).join('');
  } catch (e) { console.error('loadArchive', e); }
}

async function downloadFile(id, name) {
  try {
    const r = await fetch(API + '/files/' + id + '/download');
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Download failed'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name || 'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.error('download', e); }
}

async function createTask() {
  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-desc').value;
  const assigneeRaw = document.getElementById('task-assignee').value;
  const assigneeId = assigneeRaw ? parseInt(assigneeRaw, 10) : null;
  const fileInput = document.getElementById('task-files');
  const sel = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (sel.length > 3) { alert('Максимум 3 файла'); return; }
  for (const f of sel) { if (f.size > 10 * 1024 * 1024) { alert('Файл > 10 МБ: ' + f.name); return; } }
  try {
    const res = await fetch(API + '/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assignee_id: assigneeId })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('task-title').value = '';
      document.getElementById('task-desc').value = '';
      if (sel.length) {
        const fd = new FormData();
        sel.forEach(f => fd.append('files', f));
        fd.append('task_id', String(data.id));
        const ur = await fetch(API + '/files', { method: 'POST', body: fd });
        if (!ur.ok) {
          const ud = await ur.json().catch(() => ({}));
          alert('Задача создана, но загрузка не удалась: ' + (ud.error || ''));
        }
        fileInput.value = '';
      }
      switchTab('tasks');
    } else { alert(data.error); }
  } catch (e) { console.error('createTask', e); }
}

function openDrawer(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  const dr = document.getElementById('drawer');
  const ov = document.getElementById('drawer-overlay');
  document.getElementById('drawer-body').innerHTML =
    '<h3>' + escapeHtml(t.title) + '</h3>' +
    '<p><span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span></p>' +
    '<p class="task-desc">' + escapeHtml(t.description || '—') + '</p>' +
    '<div class="task-meta"><small>Исполнитель: ' + escapeHtml(t.assignee_username || '—') + '<br>Создал: ' + escapeHtml(t.creator_username || '—') + '<br>' + fmtDate(t.created_at) + '</small></div>' +
    '<div class="task-actions" id="drawer-files"></div>';
  dr.classList.add('open'); ov.classList.add('open');
  fetch(API + '/files?task_id=' + id).then(r => r.json()).then(fs => {
    const box = document.getElementById('drawer-files');
    if (!box) return;
    if (!Array.isArray(fs) || fs.length === 0) { box.innerHTML = '<span class="small-note">Вложений нет</span>'; return; }
    box.innerHTML = fs.map(f => '<button class="chip" data-act="download" data-id="' + f.id + '" data-name="' + escapeHtml(f.original_name) + '">📎 ' + escapeHtml(f.original_name) + '</button>').join('');
  }).catch(() => {});
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

function showToast(msg, undoFn) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  const btn = document.getElementById('toast-undo');
  if (undoFn) {
    btn.style.display = '';
    btn.onclick = () => { undoFn(); hideToast(); };
  } else { btn.style.display = 'none'; btn.onclick = null; }
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(hideToast, 6000);
}
function hideToast() { document.getElementById('toast').classList.remove('show'); }

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  if (selected.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('bulk-count').textContent = 'Выбрано: ' + selected.size;
}

async function deleteTasks(ids) {
  const removed = allTasks.filter(t => ids.includes(t.id));
  allTasks = allTasks.filter(t => !ids.includes(t.id));
  ids.forEach(id => selected.delete(id));
  renderTasks();
  for (const id of ids) { await fetch(API + '/tasks/' + id, { method: 'DELETE' }); }
  showToast('Удалено: ' + ids.length, async () => {
    for (const id of ids) { await fetch(API + '/tasks/' + id + '/restore', { method: 'POST' }); }
    loadTasks();
  });
}

document.querySelector('.main-nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-btn');
  if (btn) switchTab(btn.dataset.tab);
});

document.getElementById('task-list').addEventListener('click', async e => {
  const btn = e.target.closest('button, .task-title-text');
  if (!btn) return;
  const id = parseInt(btn.dataset.id, 10);
  const act = btn.dataset.act;
  if (act === 'download') { downloadFile(btn.dataset.id, btn.dataset.name); return; }
  if (act === 'open') { openDrawer(id); return; }
  try {
    if (act === 'status') {
      const t = allTasks.find(x => x.id === id);
      const old = t ? t.status : null;
      if (t) { t.status = btn.dataset.val; renderTasks(); }
      const r = await fetch(API + '/tasks/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.val })
      });
      if (!r.ok) { if (t) t.status = old; renderTasks(); const d = await r.json(); alert(d.error); return; }
      showToast('Статус обновлён');
    } else if (act === 'delete') {
      await deleteTasks([id]);
    }
  } catch (err) { console.error('action', err); }
});

document.getElementById('task-list').addEventListener('change', e => {
  const chk = e.target.closest('.task-check');
  if (!chk) return;
  const id = parseInt(chk.dataset.id, 10);
  if (chk.checked) selected.add(id); else selected.delete(id);
  const card = chk.closest('.task-card');
  if (card) card.classList.toggle('selected', chk.checked);
  updateBulkBar();
});

document.getElementById('archive-list').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.act !== 'restore') return;
  try {
    const r = await fetch(API + '/tasks/' + btn.dataset.id + '/restore', { method: 'POST' });
    if (!r.ok) { const d = await r.json(); alert(d.error); return; }
    loadTasks(); loadArchive();
  } catch (err) { console.error('restore', err); }
});

document.getElementById('search-input').addEventListener('input', e => { searchTerm = e.target.value; renderTasks(); });
document.getElementById('filter-status').addEventListener('change', e => { filterStatus = e.target.value; renderTasks(); });
document.getElementById('sort-by').addEventListener('change', e => { sortBy = e.target.value; renderTasks(); });
document.querySelectorAll('.view-chip[data-view]').forEach(ch => {
  ch.addEventListener('click', () => {
    currentView = ch.dataset.view;
    document.querySelectorAll('.view-chip[data-view]').forEach(c => c.classList.toggle('active', c === ch));
    renderTasks();
  });
});
document.getElementById('bulk-delete').addEventListener('click', () => {
  if (selected.size === 0) return;
  deleteTasks(Array.from(selected));
});
document.getElementById('bulk-clear').addEventListener('click', () => { selected.clear(); renderTasks(); });
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.getElementById('drawer').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act="download"]');
  if (btn) downloadFile(btn.dataset.id, btn.dataset.name);
});

localStorage.removeItem('token');
localStorage.removeItem('role');
token = null; role = null;
showLogin();