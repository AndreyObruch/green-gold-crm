const API = '/api';
let token = null, role = null, me = null;
let allTasks = [], usersCache = [], selected = new Set();
let orderIds = [], customViews = [];
let currentView = 'all', searchTerm = '', filterStatus = 'all', sortBy = 'date_desc';
let dragId = null;

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
  restoreUI();
  loadUsers();
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
      token = data.token; role = data.role; me = username;
      localStorage.setItem('token', token);
      localStorage.setItem('role', role);
      localStorage.setItem('username', me);
      showDashboard();
    } else { alert(data.error); }
  } catch (e) { alert('Server unavailable'); }
}

function logout() {
  localStorage.removeItem('token'); localStorage.removeItem('role'); localStorage.removeItem('username');
  token = null; role = null; me = null;
  allTasks = []; usersCache = []; selected.clear();
  toggleRules(false);
  showLogin();
}

async function loadUsers() {
  try {
    const res = await fetch(API + '/users');
    const users = await res.json();
    usersCache = Array.isArray(users) ? users : [];
    const sel = document.getElementById('task-assignee');
    sel.innerHTML = '';
    usersCache.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.username + ' (' + u.role + ')';
      sel.appendChild(opt);
    });
  } catch (e) { console.error('loadUsers', e); }
}

function persistUI() {
  localStorage.setItem('gg_ui', JSON.stringify({ view: currentView, search: searchTerm, filter: filterStatus, sort: sortBy }));
}
function restoreUI() {
  try {
    orderIds = JSON.parse(localStorage.getItem('gg_order') || '[]');
    customViews = JSON.parse(localStorage.getItem('gg_views') || '[]');
    const ui = JSON.parse(localStorage.getItem('gg_ui') || 'null');
    if (ui) { currentView = ui.view || 'all'; searchTerm = ui.search || ''; filterStatus = ui.filter || 'all'; sortBy = ui.sort || 'date_desc'; }
  } catch (e) { }
  const sb = document.getElementById('sort-by');
  if (sb && ![...sb.options].some(o => o.value === 'manual')) {
    const o = document.createElement('option'); o.value = 'manual'; o.textContent = 'Вручную (перетаскивание)'; sb.appendChild(o);
  }
  if (sb) sb.value = sortBy;
  const fs = document.getElementById('filter-status'); if (fs) fs.value = filterStatus;
  const si = document.getElementById('search-input'); if (si) si.value = searchTerm;
  injectSaveViewBtn();
  renderCustomViews();
  syncViewChips();
}

function viewsRow() { return document.querySelector('.saved-views:not(#counters)'); }
function injectSaveViewBtn() {
  const row = viewsRow(); if (!row) return;
  if (!document.getElementById('save-view')) {
    const b = document.createElement('button');
    b.id = 'save-view'; b.className = 'view-chip'; b.textContent = '\uFF0B \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432\u0438\u0434';
    row.appendChild(b);
  }
}
function renderCustomViews() {
  const row = viewsRow(); if (!row) return;
  row.querySelectorAll('[data-cview]').forEach(el => el.remove());
  const saveBtn = document.getElementById('save-view');
  customViews.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'view-chip'; b.dataset.cview = i;
    b.innerHTML = escapeHtml(v.name) + ' <span data-del="' + i + '" style="margin-left:6px;cursor:pointer" title="\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0438\u0434">\u00D7</span>';
    row.insertBefore(b, saveBtn);
  });
}
function syncViewChips() {
  document.querySelectorAll('.view-chip[data-view]').forEach(c => c.classList.toggle('active', c.dataset.view === currentView && !currentView.startsWith('cv:')));
  document.querySelectorAll('.view-chip[data-cview]').forEach(c => c.classList.toggle('active', currentView === 'cv:' + c.dataset.cview));
}
function applyNamedView(v) {
  searchTerm = v.search || ''; filterStatus = v.filter || 'all'; sortBy = v.sort || 'date_desc'; currentView = v.view || 'all';
  const si = document.getElementById('search-input'); if (si) si.value = searchTerm;
  const fs = document.getElementById('filter-status'); if (fs) fs.value = filterStatus;
  const sb = document.getElementById('sort-by'); if (sb) sb.value = sortBy;
  persistUI(); syncViewChips(); renderTasks();
}

function applyView(tasks) {
  let out = tasks.slice();
  if (currentView === 'mine') out = out.filter(t => t.assignee_username === me);
  if (currentView === 'active') out = out.filter(t => t.status !== 'done');
  if (filterStatus !== 'all') out = out.filter(t => t.status === filterStatus);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    out = out.filter(t => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q) || (t.assignee_username || '').toLowerCase().includes(q));
  }
  const idx = id => { const p = orderIds.indexOf(id); return p === -1 ? 999999 : p; };
  if (sortBy === 'manual') out.sort((a, b) => idx(a.id) - idx(b.id));
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
    '<span class="view-chip st-new">\u041D\u043E\u0432\u044B\u0435: ' + c.new + '</span>' +
    '<span class="view-chip st-prog">\u0412 \u0440\u0430\u0431\u043E\u0442\u0435: ' + c.in_progress + '</span>' +
    '<span class="view-chip st-done">\u0413\u043E\u0442\u043E\u0432\u043E: ' + c.done + '</span>';
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const view = applyView(allTasks);
  renderCounters(allTasks);
  if (view.length === 0) { list.innerHTML = '<li class="empty-state">\u041D\u0435\u0442 \u0437\u0430\u0434\u0430\u0447 \u043F\u043E\u0434 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0444\u0438\u043B\u044C\u0442\u0440</li>'; updateBulkBar(); return; }
  const manual = sortBy === 'manual';
  list.innerHTML = view.map(t => {
    const badge = '<span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span>';
    const chk = role === 'admin' ? '<input type="checkbox" class="task-check" data-id="' + t.id + '"' + (selected.has(t.id) ? ' checked' : '') + '>' : '';
    const head = '<div class="task-head">' + chk + '<b class="task-title-text" data-act="open" data-id="' + t.id + '" style="cursor:pointer">' + escapeHtml(t.title) + '</b>' + badge + '</div>';
    const desc = (t.description && String(t.description).trim()) ? '<div class="task-desc">' + escapeHtml(String(t.description)).replace(/\n/g, '<br>') + '</div>' : '';
    const mp = ['\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: ' + escapeHtml(t.assignee_username || '\u2014')];
    if (t.creator_username) mp.push('\u0421\u043E\u0437\u0434\u0430\u043B: ' + escapeHtml(t.creator_username));
    const d = fmtDate(t.created_at); if (d) mp.push(d);
    const meta = '<div class="task-meta"><small>' + mp.join(' \u00B7 ') + '</small></div>';
    const filesBox = '<div class="task-actions" id="files-' + t.id + '"></div>';
    let acts = '<div class="task-actions">';
    ['new', 'in_progress', 'done'].forEach(s => {
      acts += '<button class="chip chip-' + statusClass(s) + '" data-act="status" data-val="' + s + '" data-id="' + t.id + '">' + statusLabel(s) + '</button> ';
    });
    if (role === 'admin') {
      acts += '<button class="chip" data-act="edit" data-id="' + t.id + '">\u041F\u0440\u0430\u0432\u043A\u0430</button> ';
      acts += '<button class="chip chip-del" data-act="delete" data-id="' + t.id + '">\u0423\u0434\u0430\u043B\u0438\u0442\u044C</button>';
    }
    acts += '</div>';
    return '<li class="task-card' + (selected.has(t.id) ? ' selected' : '') + '" data-task="' + t.id + '"' + (manual ? ' draggable="true"' : '') + '>' + head + desc + meta + filesBox + acts + '</li>';
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
        '<button class="chip" data-act="download" data-id="' + f.id + '" data-name="' + escapeHtml(f.original_name) + '">\uD83D\uDCCE ' + escapeHtml(f.original_name) + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)</button>'
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
      const mp = ['\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: ' + escapeHtml(t.assignee_username || '\u2014')];
      if (t.creator_username) mp.push('\u0421\u043E\u0437\u0434\u0430\u043B: ' + escapeHtml(t.creator_username));
      const d = fmtDate(t.created_at); if (d) mp.push(d);
      const meta = '<div class="task-meta"><small>' + mp.join(' \u00B7 ') + '</small></div>';
      const acts = '<div class="task-actions"><button class="chip chip-restore" data-act="restore" data-id="' + t.id + '">\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C</button></div>';
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
  if (sel.length > 3) { alert('\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 3 \u0444\u0430\u0439\u043B\u0430'); return; }
  for (const f of sel) { if (f.size > 10 * 1024 * 1024) { alert('\u0424\u0430\u0439\u043B > 10 \u041C\u0411: ' + f.name); return; } }
  if (!title.trim()) { alert('\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E'); return; }
  const tempId = -Date.now();
  const au = usersCache.find(u => u.id === assigneeId);
  allTasks.unshift({
    id: tempId, title: title, description: description, status: 'new',
    assignee_id: assigneeId, assignee_username: au ? au.username : null,
    creator_username: me, created_at: new Date().toISOString()
  });
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  switchTab('tasks');
  try {
    const res = await fetch(API + '/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assignee_id: assigneeId })
    });
    const data = await res.json();
    if (!res.ok) {
      allTasks = allTasks.filter(t => t.id !== tempId); renderTasks(); alert(data.error); return;
    }
    const t = allTasks.find(x => x.id === tempId);
    if (t) t.id = data.id;
    if (sel.length) {
      const fd = new FormData();
      sel.forEach(f => fd.append('files', f));
      fd.append('task_id', String(data.id));
      const ur = await fetch(API + '/files', { method: 'POST', body: fd });
      if (!ur.ok) {
        const ud = await ur.json().catch(() => ({}));
        alert('\u0417\u0430\u0434\u0430\u0447\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430, \u043D\u043E \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043D\u0435 \u0443\u0434\u0430\u043B\u0430\u0441\u044C: ' + (ud.error || ''));
      }
      fileInput.value = '';
    }
    renderTasks();
    showToast('\u0417\u0430\u0434\u0430\u0447\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430');
  } catch (e) {
    allTasks = allTasks.filter(t => t.id !== tempId); renderTasks(); console.error('createTask', e);
  }
}

function openDrawer(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  const dr = document.getElementById('drawer');
  const ov = document.getElementById('drawer-overlay');
  let edit = '';
  if (role === 'admin') {
    const opts = usersCache.map(u => '<option value="' + u.id + '"' + (u.id === t.assignee_id ? ' selected' : '') + '>' + escapeHtml(u.username) + '</option>').join('');
    edit = '<div class="field"><label for="edit-title">\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435</label><input type="text" id="edit-title" value="' + escapeHtml(t.title) + '"></div>' +
      '<div class="field"><label for="edit-desc">\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435</label><textarea id="edit-desc">' + escapeHtml(t.description || '') + '</textarea></div>' +
      '<div class="form-row"><div class="field"><label for="edit-assignee">\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C</label><select id="edit-assignee"><option value="">\u2014</option>' + opts + '</select></div>' +
      '<div class="field"><label for="edit-status">\u0421\u0442\u0430\u0442\u0443\u0441</label><select id="edit-status">' +
      ['new', 'in_progress', 'done'].map(s => '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>').join('') +
      '</select></div></div>' +
      '<button class="btn btn-gold" data-act="save-edit" data-id="' + t.id + '">\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C</button>';
  }
  document.getElementById('drawer-body').innerHTML =
    '<h3>' + escapeHtml(t.title) + '</h3>' +
    '<p><span class="status-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span></p>' +
    '<p class="task-desc">' + escapeHtml(t.description || '\u2014') + '</p>' +
    '<div class="task-meta"><small>\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: ' + escapeHtml(t.assignee_username || '\u2014') + '<br>\u0421\u043E\u0437\u0434\u0430\u043B: ' + escapeHtml(t.creator_username || '\u2014') + '<br>' + fmtDate(t.created_at) + '</small></div>' +
    '<div class="task-actions" id="drawer-files"></div>' + edit;
  dr.classList.add('open'); ov.classList.add('open');
  fetch(API + '/files?task_id=' + id).then(r => r.json()).then(fs => {
    const box = document.getElementById('drawer-files');
    if (!box) return;
    if (!Array.isArray(fs) || fs.length === 0) { box.innerHTML = '<span class="small-note">\u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0439 \u043D\u0435\u0442</span>'; return; }
    box.innerHTML = fs.map(f => '<button class="chip" data-act="download" data-id="' + f.id + '" data-name="' + escapeHtml(f.original_name) + '">\uD83D\uDCCE ' + escapeHtml(f.original_name) + '</button>').join('');
  }).catch(() => { });
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

async function saveEdit(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  const payload = {
    title: document.getElementById('edit-title').value,
    description: document.getElementById('edit-desc').value,
    status: document.getElementById('edit-status').value,
    assignee_id: document.getElementById('edit-assignee').value || null
  };
  const old = { title: t.title, description: t.description, status: t.status, assignee_id: t.assignee_id, assignee_username: t.assignee_username };
  Object.assign(t, { title: payload.title, description: payload.description, status: payload.status, assignee_id: payload.assignee_id });
  const au = usersCache.find(u => u.id === payload.assignee_id);
  t.assignee_username = au ? au.username : null;
  renderTasks(); closeDrawer();
  try {
    const r = await fetch(API + '/tasks/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      Object.assign(t, old); renderTasks();
      const d = await r.json(); alert(d.error); return;
    }
    showToast('\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E');
  } catch (e) { Object.assign(t, old); renderTasks(); console.error('saveEdit', e); }
}

function showToast(msg, undoFn) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  const btn = document.getElementById('toast-undo');
  if (undoFn) { btn.style.display = ''; btn.onclick = () => { undoFn(); hideToast(); }; }
  else { btn.style.display = 'none'; btn.onclick = null; }
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
  document.getElementById('bulk-count').textContent = '\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ' + selected.size;
}

async function deleteTasks(ids) {
  allTasks = allTasks.filter(t => !ids.includes(t.id));
  ids.forEach(id => selected.delete(id));
  renderTasks();
  for (const id of ids) { await fetch(API + '/tasks/' + id, { method: 'DELETE' }); }
  showToast('\u0423\u0434\u0430\u043B\u0435\u043D\u043E: ' + ids.length, async () => {
    for (const id of ids) { await fetch(API + '/tasks/' + id + '/restore', { method: 'POST' }); }
    loadTasks();
  });
}

function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('li.task-card:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

function toggleRules(force) {
  const drop = document.getElementById('rules-drop');
  if (!drop) return;
  const open = typeof force === 'boolean' ? force : !drop.classList.contains('open');
  drop.classList.toggle('open', open);
}

document.querySelector('.main-nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-btn');
  if (btn) switchTab(btn.dataset.tab);
});

const taskList = document.getElementById('task-list');
taskList.addEventListener('click', async e => {
  const btn = e.target.closest('button, .task-title-text');
  if (!btn) return;
  const id = parseInt(btn.dataset.id, 10);
  const act = btn.dataset.act;
  if (act === 'download') { downloadFile(btn.dataset.id, btn.dataset.name); return; }
  if (act === 'open') { openDrawer(id); return; }
  if (act === 'edit') { openDrawer(id); return; }
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
      showToast('\u0421\u0442\u0430\u0442\u0443\u0441 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D');
    } else if (act === 'delete') {
      await deleteTasks([id]);
    }
  } catch (err) { console.error('action', err); }
});

taskList.addEventListener('change', e => {
  const chk = e.target.closest('.task-check');
  if (!chk) return;
  const id = parseInt(chk.dataset.id, 10);
  if (chk.checked) selected.add(id); else selected.delete(id);
  const card = chk.closest('.task-card');
  if (card) card.classList.toggle('selected', chk.checked);
  updateBulkBar();
});

taskList.addEventListener('dragstart', e => {
  const li = e.target.closest('li.task-card');
  if (!li || sortBy !== 'manual') return;
  dragId = parseInt(li.dataset.task, 10);
  li.classList.add('dragging');
  li.style.opacity = '0.5';
});
taskList.addEventListener('dragover', e => {
  if (sortBy !== 'manual') return;
  e.preventDefault();
  const dragging = taskList.querySelector('li.dragging');
  if (!dragging) return;
  const after = getDragAfterElement(taskList, e.clientY);
  if (after == null) taskList.appendChild(dragging);
  else taskList.insertBefore(dragging, after);
});
taskList.addEventListener('dragend', e => {
  const li = e.target.closest('li.task-card');
  if (li) { li.classList.remove('dragging'); li.style.opacity = ''; }
  orderIds = [...taskList.querySelectorAll('li.task-card')].map(x => parseInt(x.dataset.task, 10));
  localStorage.setItem('gg_order', JSON.stringify(orderIds));
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

document.getElementById('search-input').addEventListener('input', e => { searchTerm = e.target.value; persistUI(); renderTasks(); });
document.getElementById('filter-status').addEventListener('change', e => { filterStatus = e.target.value; persistUI(); renderTasks(); });
document.getElementById('sort-by').addEventListener('change', e => { sortBy = e.target.value; persistUI(); renderTasks(); });

viewsRow().addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    customViews.splice(parseInt(del.dataset.del, 10), 1);
    localStorage.setItem('gg_views', JSON.stringify(customViews));
    renderCustomViews(); syncViewChips(); return;
  }
  const cv = e.target.closest('[data-cview]');
  if (cv) { currentView = 'cv:' + cv.dataset.cview; applyNamedView(customViews[parseInt(cv.dataset.cview, 10)]); return; }
  const pv = e.target.closest('[data-view]');
  if (pv) { currentView = pv.dataset.view; persistUI(); syncViewChips(); renderTasks(); return; }
  if (e.target.closest('#save-view')) {
    const name = prompt('\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0432\u0438\u0434\u0430:');
    if (!name) return;
    customViews.push({ name, view: currentView, search: searchTerm, filter: filterStatus, sort: sortBy });
    localStorage.setItem('gg_views', JSON.stringify(customViews));
    renderCustomViews(); syncViewChips();
  }
});

document.getElementById('bulk-delete').addEventListener('click', () => {
  if (selected.size === 0) return;
  deleteTasks(Array.from(selected));
});
document.getElementById('bulk-clear').addEventListener('click', () => { selected.clear(); renderTasks(); });
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.getElementById('drawer').addEventListener('click', e => {
  const dl = e.target.closest('button[data-act="download"]');
  if (dl) { downloadFile(dl.dataset.id, dl.dataset.name); return; }
  const sv = e.target.closest('button[data-act="save-edit"]');
  if (sv) saveEdit(parseInt(sv.dataset.id, 10));
});

document.getElementById('rules-btn').addEventListener('click', e => {
  e.stopPropagation();
  toggleRules();
});
document.getElementById('rules-drop').addEventListener('click', e => { e.stopPropagation(); });
document.addEventListener('click', e => {
  const drop = document.getElementById('rules-drop');
  if (drop.classList.contains('open') && !drop.contains(e.target)) toggleRules(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleRules(false); closeDrawer(); }
});

localStorage.removeItem('token');
localStorage.removeItem('role');
localStorage.removeItem('username');
token = null; role = null; me = null;
showLogin();