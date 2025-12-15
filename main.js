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

// ===== Helpers (UNCHANGED) =====

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

// ===== EXPORT FUNCTION (UNCHANGED) =====

function exportAndDownloadData(allTasksData, allProjectsData) {
  const data = {
    exportTimestamp: new Date().toISOString(),
    // Log the current global state variables
    currentAppState: {
        todayTasks: todayTasks,
        allTasks: allTasks,
        projectsById: projectsById,
        selectedLeftId: selectedLeftId,
        selectedRightId: selectedRightId
    },
    // Log the raw data fetched from the Todoist API
    apiData: {
        tasks: allTasksData,
        projects: allProjectsData
    }
  };
  
  // Convert the object to a formatted JSON string
  const jsonString = JSON.stringify(data, null, 2);
  
  // Create a Blob containing the JSON data
  const blob = new Blob([jsonString], { type: 'application/json' });
  
  // Create a URL for the blob
  const url = URL.createObjectURL(blob);
  
  // Create a temporary anchor element for the download
  const a = document.createElement('a');
  a.href = url;
  
  // Create a timestamped filename
  const now = new Date();
  const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `todoist-log-${datetime}.json`;
  
  // Programmatically click the link to trigger the download
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up the object URL
  URL.revokeObjectURL(url);
  
  console.log(`[data] Downloaded full state to ${a.download}`);
}


// ===== Rendering (UNCHANGED) =====

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

// ===== Data fetch (UNCHANGED) =====

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
  
  return { tasks, projects };
}

// ===== CLONE-AND-DELETE IMPLEMENTATION (MODIFIED) =====

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  const left = todayTasks.find(t => t.id === selectedLeftId);
  const right = allTasks.find(t => t.id === selectedRightId);

  if (!left || !right || left.id === right.id) {
    moveStatus.textContent = 'Invalid selection';
    return;
  }
  
  // NOTE: This approach assumes the 'left' task does NOT have its own subtasks.

  btnMove.disabled = true;
  moveStatus.textContent = 'Cloning task as subtask (Step 1 of 2)...';

  try {
    // ---------------------------------------------------------------------
    // STEP 1: CLONE/CREATE THE NEW SUBTASK
    // Build the payload for the new subtask, copying all relevant fields
    const newTaskPayload = {
      content: left.content,
      description: left.description,
      project_id: right.project_id, // New project ID from the right parent task
      parent_id: right.id,          // NEW PARENT ID
      priority: left.priority,
      labels: left.labels,
      // Only include 'due' if it exists on the original task
      ...(left.due && { due_string: left.due.string }) // Re-uses the due string
    };

    console.log('[move] STEP 1: Creating new subtask with payload:', newTaskPayload);
    // Use the REST API /tasks endpoint to create the new task
    await callTodoist('/tasks', {
      method: 'POST',
      body: JSON.stringify(newTaskPayload)
    });
    // ---------------------------------------------------------------------
    
    moveStatus.textContent = 'Deleting original task (Step 2 of 2)...';

    // ---------------------------------------------------------------------
    // STEP 2: DELETE THE ORIGINAL TASK
    console.log('[move] STEP 2: Deleting original task', left.id);
    await callTodoist(`/tasks/${left.id}`, {
      method: 'DELETE'
    });
    // ---------------------------------------------------------------------

    moveStatus.textContent = '✅ Cloned and Deleted! Refreshing...';
    setTimeout(fetchData, 1500);
  } catch (err) {
    console.error('[move] Error:', err);
    moveStatus.textContent = '❌ ' + err.message;
  } finally {
    btnMove.disabled = false;
  }
}


// ===== OAuth flow (UNCHANGED) =====

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

// ===== Event wiring (UNCHANGED) =====

btnAuth.addEventListener('click', () => startOAuth());

btnRefresh.addEventListener('click', async () => {
  console.log('[ui] Refresh clicked, loading new data and preparing export.');
  try {
    // 1. Fetch data
    const { tasks, projects } = await fetchData();
    
    // 2. Export the newly fetched data
    exportAndDownloadData(tasks, projects);
    
  } catch (err) {
    console.error('[data] Refresh/Export failed:', err);
    moveStatus.textContent = 'Refresh or Export failed: ' + err.message;
  }
});

btnMove.addEventListener('click', () => {
  console.log('[ui] Move clicked.');
  performMove();
});

window.addEventListener('DOMContentLoaded', async () => {
  console.log('[init] DOMContentLoaded, handling possible OAuth redirect.');
  await handleOAuthRedirect();
  if (hasToken()) {
    console.log('[init] Token already present, showing app.');
    showApp();
  } else {
    console.log('[init] No token yet, waiting for auth.');
  }
});
