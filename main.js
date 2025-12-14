// main.js - FIXED with Todoist SYNC API v9

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

function getBaseUrl() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

function saveToken(token) {
  accessToken = token;
}

function hasToken() {
  return !!accessToken;
}

async function callTodoist(path, options = {}) {
  if (!accessToken) throw new Error('No access token');
  
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
    const body = await res.text();
    throw new Error(`Todoist error ${res.status}: ${body}`);
  }
  
  if (res.status === 204) return null;
  return res.json();
}

async function callSyncApi(commands) {
  if (!accessToken) throw new Error('No access token');
  
  const res = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sync_token: '*',
      resource_types: ['["projects","items"]']
    })
  });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync API error ${res.status}: ${body}`);
  }
  
  return res.json();
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateMoveButtonState() {
  btnMove.disabled = !(selectedLeftId && selectedRightId);
}

function renderLists() {
  todayListEl.innerHTML = '';
  if (!todayTasks.length) {
    todayStatus.textContent = 'No Today tasks found.';
    return;
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

  allListEl.innerHTML = '';
  if (!allTasks.length) {
    allStatus.textContent = 'No tasks available.';
    return;
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

async function fetchData() {
  todayStatus.textContent = 'Loading...';
  allStatus.textContent = 'Loading...';
  
  const [projects, tasks] = await Promise.all([
    callTodoist('/projects'),
    callTodoist('/tasks')
  ]);

  projectsById = {};
  projects.forEach(p => projectsById[p.id] = p);

  const todayIso = new Date().toISOString().slice(0, 10);
  const tasksToday = tasks.filter(t => 
    t.due && (t.due.date === todayIso || (t.due.datetime && t.due.datetime.slice(0, 10) === todayIso))
  );

  const todayIds = new Set(tasksToday.map(t => t.id));
  const byId = {};
  tasks.forEach(t => byId[t.id] = t);

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

  selectedLeftId = null;
  selectedRightId = null;
  updateMoveButtonState();
  renderLists();
}

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  const left = todayTasks.find(t => t.id === selectedLeftId);
  const right = allTasks.find(t => t.id === selectedRightId);

  if (!left || !right || left.id === right.id) {
    moveStatus.textContent = 'Invalid selection';
    return;
  }

  btnMove.disabled = true;
  moveStatus.textContent = 'Moving...';

  try {
    // Build SYNC commands
    const commands = [];
    const uuid = crypto.randomUUID();

    // Move main task to right's project and set parent
    commands.push({
      type: 'item_move',
      uuid: `${uuid}-main`,
      args: {
        id: left.id,
        project_id: right.project_id,
        parent_id: right.id
      }
    });

    // Find and move children
    const allTasksFlat = [...todayTasks, ...allTasks];
    const byId = {};
    allTasksFlat.forEach(t => byId[t.id] = t);

    function findChildren(taskId) {
      return allTasksFlat.filter(task => {
        let current = task;
        while (current.parent_id) {
          if (current.parent_id === taskId) return true;
          current = byId[current.parent_id];
          if (!current) break;
        }
        return false;
      });
    }

    const children = findChildren(left.id);
    for (const child of children) {
      commands.push({
        type: 'item_move',
        uuid: `${uuid}-${child.id}`,
        args: {
          id: child.id,
          project_id: right.project_id,
          parent_id: left.id
        }
      });
    }

    console.log('SYNC commands:', commands);

    // Execute via sync API
    await callSyncApi(commands);
    
    moveStatus.textContent = '✅ Moved! Refreshing...';
    setTimeout(fetchData, 1000);
  } catch (err) {
    console.error(err);
    moveStatus.textContent = '❌ ' + err.message;
  } finally {
    btnMove.disabled = false;
  }
}

function startOAuth() {
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

  if (error || !code) return;
  
  const storedState = sessionStorage.getItem('todoist_oauth_state');
  if (storedState !== state) return;

  try {
    const res = await fetch(OAUTH_FUNCTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: getBaseUrl() })
    });

    if (!res.ok) throw new Error('Token exchange failed');
    
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

// Event wiring
btnAuth.addEventListener('click', startOAuth);
btnRefresh.addEventListener('click', fetchData);
btnMove.addEventListener('click', performMove);

window.addEventListener('DOMContentLoaded', async () => {
  await handleOAuthRedirect();
  if (hasToken()) showApp();
});
