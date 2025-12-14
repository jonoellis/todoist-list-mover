// main.js

// Netlify function endpoint
const OAUTH_FUNCTION_PATH = '/.netlify/functions/todoist-oauth';

let accessToken = null;
let todayTasks = [];
let allTasks = [];
let projectsById = {};

let selectedLeftId = null;
let selectedRightId = null;

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

// ===== Helpers =====

function getBaseUrl() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

function saveToken(token) {
  console.log('[auth] Saving access token (masked).');
  accessToken = token;
}

function hasToken() {
  return !!accessToken;
}

async function callTodoist(path, options = {}) {
  if (!accessToken) {
    throw new Error('No access token');
  }
  const url = `https://api.todoist.com/rest/v2${path}`;
  console.log('[todoist] Request:', url, options);

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  let bodyText = '';
  try {
    bodyText = await res.clone().text();
  } catch (e) {
    // ignore
  }

  console.log('[todoist] Response:', url, res.status, bodyText);

  if (!res.ok) {
    let msg = `Todoist error ${res.status}`;
    try {
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (body && body.message) msg += `: ${body.message}`;
    } catch (_) {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return bodyText ? JSON.parse(bodyText) : null;
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

// ===== Rendering =====

function renderLists() {
  console.log('[ui] Rendering lists. Today:', todayTasks.length, 'All:', allTasks.length);

  // Left column
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
      console.log('[ui] Selected left task:', selectedLeftId, task);
      updateMoveButtonState();
    });
    el.querySelector('.task-main').addEventListener('click', () => radio.click());
    todayListEl.appendChild(el);
  });

  // Right column
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
      console.log('[ui] Selected right task:', selectedRightId, task);
      updateMoveButtonState();
    });
    el.querySelector('.task-main').addEventListener('click', () => radio.click());
    allListEl.appendChild(el);
  });
}

// ===== Data fetch =====

async function fetchData() {
  console.log('[data] Fetching projects and tasks...');
  todayStatus.textContent = 'Loading Today tasks...';
  allStatus.textContent = 'Loading tasks...';
  moveStatus.textContent = '';

  const [projects, tasks] = await Promise.all([
    callTodoist('/projects'),
    callTodoist('/tasks')
  ]);

  console.log('[data] Projects loaded:', projects.length);
  console.log('[data] Tasks loaded:', tasks.length);

  projectsById = {};
  projects.forEach(p => {
    projectsById[p.id] = p;
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  console.log('[data] Today ISO date:', todayIso);

  const tasksToday = tasks.filter(t => {
    if (!t.due) return false;
    if (t.due.date === todayIso) return true;
    if (t.due.datetime && t.due.datetime.slice(0, 10) === todayIso) return true;
    return false;
  });
  console.log('[data] Raw Today tasks count:', tasksToday.length);

  const todayIds = new Set(tasksToday.map(t => t.id));
  const byId = {};
  tasks.forEach(t => { byId[t.id] = t; });

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

  allTasks = tasks.filter(t => !t.parent_id).sort((a, b) =>
    String(a.content).localeCompare(String(b.content))
  );

  console.log('[data] Today+subtasks count:', todayTasks.length);
  console.log('[data] All parent tasks count:', allTasks.length);

  selectedLeftId = null;
  selectedRightId = null;
  updateMoveButtonState();
  renderLists();
}

// ===== Move logic (FIXED: numeric project_id + skip same project) =====

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  console.log('[move] Starting move. leftId:', selectedLeftId, 'rightId:', selectedRightId);

  const left = todayTasks.find(t => t.id === selectedLeftId);
  const right = allTasks.find(t => t.id === selectedRightId);

  console.log('[move] Left task:', left ? {id: left.id, project_id: left.project_id, content: left.content} : 'NOT FOUND');
  console.log('[move] Right task:', right ? {id: right.id, project_id: right.project_id, content: right.content} : 'NOT FOUND');

  if (!left || !right) {
    moveStatus.textContent = 'Selection invalid. Refresh and try again.';
    return;
  }

  if (left.id === right.id) {
    moveStatus.textContent = 'Cannot make a task a subtask of itself.';
    return;
  }

  if (!projectsById[right.project_id]) {
    moveStatus.textContent = 'Destination project not found.';
    console.error('[move] Project not found:', right.project_id);
    return;
  }

  console.log('[move] Target project:', projectsById[right.project_id].name);

  btnMove.disabled = true;
  moveStatus.textContent = 'Moving...';

  try {
    // STEP 1: Move left task to right's project (ONLY if different, with Number conversion)
    if (String(left.project_id) !== String(right.project_id)) {
      console.log('[move] STEP 1: Moving from project', left.project_id, '→', right.project_id);
      await callTodoist(`/tasks/${left.id}`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: Number(right.project_id)
        })
      });
    } else {
      console.log('[move] STEP 1: SKIPPED - already in target project', right.project_id);
    }

    // STEP 2: Set parent_id to right task
    console.log('[move] STEP 2: Setting parent_id to', right.id);
    await callTodoist(`/tasks/${left.id}`, {
      method: 'POST',
      body: JSON.stringify({
        parent_id: right.id
      })
    });

    // Find and move children
    const allTasksFlat = [...todayTasks, ...allTasks];
    const byId = {};
    allTasksFlat.forEach(t => { byId[t.id] = t; });

    function findChildren(taskId) {
      const children = [];
      for (const task of allTasksFlat) {
        let current = task;
        while (current.parent_id) {
          if (current.parent_id === taskId) {
            children.push(current);
            break;
          }
          current = byId[current.parent_id];
          if (!current) break;
        }
      }
      return children;
    }

    const childrenToMove = findChildren(left.id);
    console.log('[move] Found', childrenToMove.length, 'children to move:', childrenToMove.map(c => c.id));

    for (const child of childrenToMove) {
      // Move child to project (if needed)
      if (String(child.project_id) !== String(right.project_id)) {
        console.log('[move] Child project move:', child.id, '→', right.project_id);
        await callTodoist(`/tasks/${child.id}`, {
          method: 'POST',
          body: JSON.stringify({
            project_id: Number(right.project_id)
          })
        });
      }

      // Set child parent to left task
      console.log('[move] Child parent set:', child.id, '→', left.id);
      await callTodoist(`/tasks/${child.id}`, {
        method: 'POST',
        body: JSON.stringify({
          parent_id: left.id
        })
      });
    }

    moveStatus.textContent = '✅ Moved! Refreshing...';
    setTimeout(() => fetchData(), 1000);
  } catch (err) {
    console.error('[move] ERROR:', err);
    moveStatus.textContent = '❌ ' + err.message;
  } finally {
    btnMove.disabled = false;
  }
}

// ===== OAuth flow =====

function startOAuth() {
  authError.textContent = '';
  const baseUrl = getBaseUrl();
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('todoist_oauth_state', state);

  const params = new URLSearchParams({
    client_id: window.TODOIST_CLIENT_ID,
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
    authError.textContent = `OAuth error: ${error}`;
    return;
  }
  if (!code) return;

  const storedState = sessionStorage.getItem('todoist_oauth_state');
  if (storedState !== state) {
    authError.textContent = 'State mismatch. Try again.';
    return;
  }

  try {
    const res = await fetch(OAUTH_FUNCTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: getBaseUrl() })
    });

    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    
    const data = await res.json();
    saveToken(data.access_token);
    window.history.replaceState({}, '', getBaseUrl());
    showApp();
  } catch (err) {
    authError.textContent = 'OAuth failed: ' + err.message;
  }
}

async function showApp() {
  authView.style.display = 'none';
  appView.style.display = 'block';
  await fetchData();
}

// ===== Event wiring =====

btnAuth.addEventListener('click', startOAuth);
btnRefresh.addEventListener('click', fetchData);
btnMove.addEventListener('click', performMove);

window.addEventListener('DOMContentLoaded', handleOAuthRedirect);
if (hasToken()) showApp();
