// main.js

// ===== CONFIG =====
// You set this env var in Netlify, not here.
const TODOIST_CLIENT_ID = 'REPLACE_IN_NETLIFY_BUILD_OR_INLINE_IF_YOU_PREFER';

// Netlify function endpoint (same site)
const OAUTH_FUNCTION_PATH = '/.netlify/functions/todoist-oauth';

// Scoped state
let accessToken = null;
let todayTasks = [];
let allTasks = [];
let projectsById = {};

let selectedLeftId = null;   // task or subtask from Today
let selectedRightId = null;  // destination parent (task only)

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const btnAuth = document.getElementById('btn-auth');
const authError = document.getElementById('auth-error');

const todayListEl = document.getElementById('today-task-list');
const allListEl = document.getElementById('all-task-list');
const todayStatus = document.getElementById('today-status');
const allStatus = document.getElementById('all-status');
const moveStatus = document.getElementById('move-status');
const btnMove = document.getElementById('btn-move');
const btnRefresh = document.getElementById('btn-refresh');

// ===== HELPERS =====

function getBaseUrl() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

function saveToken(token) {
  accessToken = token;
  // session-only; no persistent storage required, but you can use sessionStorage if desired
}

function hasToken() {
  return !!accessToken;
}

async function callTodoist(path, options = {}) {
  if (!accessToken) {
    throw new Error('No access token');
  }
  const url = `https://api.todoist.com/rest/v2${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    let msg = `Todoist error ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.message) msg += `: ${body.message}`;
    } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function renderLists() {
  // left
  todayListEl.innerHTML = '';
  if (!todayTasks.length) {
    todayStatus.textContent = 'No Today tasks found.';
  } else {
    todayStatus.textContent = '';
  }
  todayTasks.forEach(task => {
    const el = document.createElement('label');
    el.className = 'task-item';
    el.dataset.subtask = task.parent_id ? 'true' : 'false';
    el.innerHTML = `
      <input type="radio" name="left-task" value="${task.id}">
      <div class="task-main">
        <div class="task-title">${escapeHtml(task.content)}</div>
        <div class="task-project">${escapeHtml(projectsById[task.project_id]?.name || 'Inbox')}</div>
        <div class="task-meta">
          ${task.parent_id ? `<span class="badge">Subtask</span>` : ''}
          ${task.due && task.due.date ? `Due: ${task.due.date}` : ''}
        </div>
      </div>
    `;
    const radio = el.querySelector('input');
    radio.addEventListener('change', () => {
      selectedLeftId = task.id;
      updateMoveButtonState();
    });
    el.querySelector('.task-main').addEventListener('click', () => radio.click());
    todayListEl.appendChild(el);
  });

  // right
  allListEl.innerHTML = '';
  if (!allTasks.length) {
    allStatus.textContent = 'No tasks available.';
  } else {
    allStatus.textContent = '';
  }
  allTasks.forEach(task => {
    const el = document.createElement('label');
    el.className = 'task-item';
    el.innerHTML = `
      <input type="radio" name="right-task" value="${task.id}">
      <div class="task-main">
        <div class="task-title">${escapeHtml(task.content)}</div>
        <div class="task-project">${escapeHtml(projectsById[task.project_id]?.name || 'Inbox')}</div>
        <div class="task-meta">
          <span class="badge">Parent</span>
          ${task.due && task.due.date ? `Due: ${task.due.date}` : ''}
        </div>
      </div>
    `;
    const radio = el.querySelector('input');
    radio.addEventListener('change', () => {
      selectedRightId = task.id;
      updateMoveButtonState();
    });
    el.querySelector('.task-main').addEventListener('click', () => radio.click());
    allListEl.appendChild(el);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateMoveButtonState() {
  btnMove.disabled = !(selectedLeftId && selectedRightId);
}

async function fetchData() {
  todayStatus.textContent = 'Loading Today tasks...';
  allStatus.textContent = 'Loading tasks...';
  moveStatus.textContent = '';

  const [projects, tasks] = await Promise.all([
    callTodoist('/projects'),
    callTodoist('/tasks')
  ]);

  projectsById = {};
  projects.forEach(p => {
    projectsById[p.id] = p;
  });

  // "Today" tasks: due.date == today or due.datetime today’s date
  const todayIso = new Date().toISOString().slice(0, 10);
  const tasksToday = tasks.filter(t => {
    if (!t.due) return false;
    if (t.due.date === todayIso) return true;
    // due_datetime may contain time; compare date part
    if (t.due.datetime && t.due.datetime.slice(0, 10) === todayIso) return true;
    return false;
  });

  // include subtasks of those Today tasks:
  // if a task is a subtask (parent_id) and its ancestor is in "today"
  const todayIds = new Set(tasksToday.map(t => t.id));
  const byId = {};
  tasks.forEach(t => {
    byId[t.id] = t;
  });

  const todayWithSubs = new Map();
  function isDescendantOfToday(t) {
    let current = t;
    while (current.parent_id) {
      current = byId[current.parent_id];
      if (!current) break;
      if (todayIds.has(current.id)) return true;
    }
    return false;
  }

  tasks.forEach(t => {
    if (todayIds.has(t.id) || isDescendantOfToday(t)) {
      todayWithSubs.set(t.id, t);
    }
  });

  todayTasks = Array.from(todayWithSubs.values()).sort((a, b) =>
    String(a.content).localeCompare(String(b.content))
  );

  // all tasks for right side: tasks with no parent (no subtasks)
  allTasks = tasks.filter(t => !t.parent_id).sort((a, b) =>
    String(a.content).localeCompare(String(b.content))
  );

  selectedLeftId = null;
  selectedRightId = null;
  updateMoveButtonState();
  renderLists();
}

// ===== MOVE LOGIC =====

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  btnMove.disabled = true;
  moveStatus.textContent = 'Moving...';

  try {
    const left = todayTasks.find(t => t.id === selectedLeftId);
    const right = allTasks.find(t => t.id === selectedRightId);
    if (!left || !right) {
      throw new Error('Selection invalid. Refresh and try again.');
    }

    // 1) Move the selected left task (or subtask) into the destination project
    //    and set its parent_id to the chosen right task.
    await callTodoist(`/tasks/${left.id}`, {
      method: 'POST',
      body: JSON.stringify({
        project_id: right.project_id,
        parent_id: right.id
      })
    });

    // 2) Move all of its subtasks (if any) to the same project and under it.
    //    Find subtasks whose ancestor is left.id.
    const byId = {};
    [...todayTasks, ...allTasks].forEach(t => { byId[t.id] = t; });

    function isDescendantOf(task, ancestorId) {
      let current = task;
      while (current.parent_id) {
        if (current.parent_id === ancestorId) return true;
        current = byId[current.parent_id];
        if (!current) break;
      }
      return false;
    }

    const childrenToMove = Object.values(byId).filter(t => isDescendantOf(t, left.id));

    for (const child of childrenToMove) {
      await callTodoist(`/tasks/${child.id}`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: right.project_id,
          parent_id: left.id
        })
      });
    }

    moveStatus.textContent = 'Moved. Refreshing...';
    await fetchData();
    moveStatus.textContent = 'Move complete.';
  } catch (err) {
    console.error(err);
    moveStatus.textContent = 'Move failed: ' + err.message;
  } finally {
    updateMoveButtonState();
  }
}

// ===== OAUTH FLOW =====

function startOAuth() {
  authError.textContent = '';
  const baseUrl = getBaseUrl();
  const state = Math.random().toString(36).slice(2);

  sessionStorage.setItem('todoist_oauth_state', state);

  const params = new URLSearchParams({
    client_id: TODOIST_CLIENT_ID,
    scope: 'data:read_write',
    state,
    redirect_uri: baseUrl
  });

  window.location.href = `https://todoist.com/oauth/authorize?${params.toString()}`;
}

async function handleOAuthRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    authError.textContent = 'Authorization declined.';
    return;
  }
  if (!code) {
    return;
  }

  const storedState = sessionStorage.getItem('todoist_oauth_state');
  if (!storedState || storedState !== state) {
    authError.textContent = 'State mismatch. Please try again.';
    return;
  }

  authError.textContent = 'Exchanging code...';

  try {
    const res = await fetch(OAUTH_FUNCTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: getBaseUrl() })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || 'Token exchange failed');
    }
    const data = await res.json();
    if (!data.access_token) {
      throw new Error('No access token returned');
    }
    saveToken(data.access_token);
    // Clean URL
    window.history.replaceState({}, document.title, getBaseUrl());
    showApp();
  } catch (err) {
    console.error(err);
    authError.textContent = 'OAuth failed: ' + err.message;
  }
}

async function showApp() {
  authView.style.display = 'none';
  appView.style.display = 'block';

  try {
    await fetchData();
  } catch (err) {
    todayStatus.textContent = 'Failed to load tasks.';
    allStatus.textContent = 'Failed to load tasks.';
    console.error(err);
  }
}

// ===== EVENT WIRING =====

btnAuth.addEventListener('click', () => {
  startOAuth();
});

btnRefresh.addEventListener('click', () => {
  fetchData().catch(err => {
    console.error(err);
    moveStatus.textContent = 'Refresh failed.';
  });
});

btnMove.addEventListener('click', () => {
  performMove();
});

// On load
window.addEventListener('DOMContentLoaded', async () => {
  // TODO: You may want to inject TODOIST_CLIENT_ID via inline script with Netlify env
  await handleOAuthRedirect();
  if (hasToken()) {
    showApp();
  }
});
