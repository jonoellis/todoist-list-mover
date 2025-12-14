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
  const base = window.location.origin + window.location.pathname;
  // Ensure trailing slash for redirect_uri
  return base.endsWith('/') ? base : base + '/';
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

// ===== Move logic (two-step updates with extra guards) =====

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  console.log('[move] Starting move. leftId:', selectedLeftId, 'rightId:', selectedRightId);

  const left = todayTasks.find(t => t.id === selectedLeftId) ||
               allTasks.find(t => t.id === selectedLeftId);
  const right = allTasks.find(t => t.id === selectedRightId);

  console.log('[move] Left task object:', left);
  console.log('[move] Right task object:', right);

  if (!left || !right) {
    moveStatus.textContent = 'Selection invalid. Refresh and try again.';
    console.error('[move] Invalid selection: left or right not found.');
    return;
  }

  if (left.id === right.id) {
    moveStatus.textContent = 'Cannot make a task a subtask of itself.';
    console.warn('[move] Attempted to make a task its own parent.');
    return;
  }

  if (!projectsById[right.project_id]) {
    moveStatus.textContent = 'Destination project no longer exists.';
    console.error('[move] Invalid project_id for right task:', right.project_id);
    return;
  }

  btnMove.disabled = true;
  moveStatus.textContent = 'Moving...';

  try {
    // Step 1: Move left task to the right task's project (if different)
    if (left.project_id !== right.project_id) {
      console.log('[move] Step 1: move left to project', right.project_id, 'from', left.project_id);
      await callTodoist(`/tasks/${left.id}`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: Number(right.project_id)
        })
      });
    } else {
      console.log('[move] Step 1: skipped, left already in target project');
    }

    // Step 2: Make left task a subtask of right
    console.log('[move] Step 2: set left.parent_id to', right.id);
    await callTodoist(`/tasks/${left.id}`, {
      method: 'POST',
      body: JSON.stringify({
        parent_id: right.id
      })
    });

    // Rebuild map from latest known tasks
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
    console.log('[move] Children to move under left:', childrenToMove.map(c => ({
      id: c.id,
      project_id: c.project_id
    })));

    for (const child of childrenToMove) {
      // Step 1 for child: move into project if needed
      if (child.project_id !== right.project_id) {
        console.log('[move] Moving child', child.id, 'to project', right.project_id, 'from', child.project_id);
        await callTodoist(`/tasks/${child.id}`, {
          method: 'POST',
          body: JSON.stringify({
            project_id: Number(right.project_id)
          })
        });
      } else {
        console.log('[move] Child', child.id, 'already in target project, skipping project move');
      }

      // Step 2 for child: set parent to left
      console.log('[move] Setting child', child.id, 'parent_id to', left.id);
      await callTodoist(`/tasks/${child.id}`, {
        method: 'POST',
        body: JSON.stringify({
          parent_id: left.id
        })
      });
    }

    moveStatus.textContent = 'Moved. Refreshing...';
    console.log('[move] Move complete, refreshing data...');
    await fetchData();
    moveStatus.textContent = 'Move complete.';
  } catch (err) {
    console.error('[move] Move failed:', err);
    moveStatus.textContent = 'Move failed: ' + err.message;
  } finally {
    updateMoveButtonState();
  }
}

// ===== OAuth flow =====

function startOAuth() {
  authError.textContent = '';
  const baseUrl = getBaseUrl();
  const state = Math.random().toString(36).slice(2);

  console.log('[auth] Starting OAuth with redirect_uri:', baseUrl, 'state:', state);

  sessionStorage.setItem('todoist_oauth_state', state);

  const params = new URLSearchParams({
    client_id: window.TODOIST_CLIENT_ID,
    scope: 'data:read_write',
    state,
    redirect_uri: baseUrl
  });

  const authUrl = `https://todoist.com/oauth/authorize?${params.toString()}`;
  console.log('[auth] Redirecting to:', authUrl);
  window.location.href = authUrl;
}

async function handleOAuthRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  console.log('[auth] Redirect params:', { code: !!code, state, error });

  if (error) {
    authError.textContent = 'Authorization declined.';
    console.warn('[auth] OAuth error from provider:', error);
    return;
  }
  if (!code) {
    console.log('[auth] No code in URL; first load or already cleaned.');
    return;
  }

  const storedState = sessionStorage.getItem('todoist_oauth_state');
  if (!storedState || storedState !== state) {
    authError.textContent = 'State mismatch. Please try again.';
    console.error('[auth] State mismatch. stored:', storedState, 'url:', state);
    return;
  }

  authError.textContent = 'Exchanging code...';
  console.log('[auth] Exchanging code for token via Netlify function.');

  try {
    const res = await fetch(OAUTH_FUNCTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: getBaseUrl() })
    });
    const text = await res.text();
    console.log('[auth] Token endpoint response:', res.status, text);

    if (!res.ok) {
      throw new Error(text || 'Token exchange failed');
    }
    const data = JSON.parse(text);
    if (!data.access_token) {
      throw new Error('No access token returned');
    }
    saveToken(data.access_token);
    window.history.replaceState({}, document.title, getBaseUrl());
    showApp();
  } catch (err) {
    console.error('[auth] OAuth failed:', err);
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
    console.error('[data] Initial load failed:', err);
  }
}

// ===== Event wiring =====

btnAuth.addEventListener('click', () => startOAuth());

btnRefresh.addEventListener('click', () => {
  console.log('[ui] Refresh clicked.');
  fetchData().catch(err => {
    console.error('[data] Refresh failed:', err);
    moveStatus.textContent = 'Refresh failed.';
  });
});

btnMove.addEventListener('click', () => {
  console.log('[ui] Move clicked.');
  performMove();
});

window.addEventListener('DOMContentLoaded', async () => {
  console.log('[init] DOMContentLoaded, handling possible OAuth redirect.');
  await handle
