const OAUTH_FUNCTION_PATH = '/.netlify/functions/todoist-oauth';

let accessToken = null;
let todayTasks = [];
let allTasks = [];
let projectsById = {};

let selectedLeftId = null;
let selectedRightId = null;
let taskSnapshotBefore = null; // New variable to store the "Before" state

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

// --- NEW DEBUGGING UI ELEMENTS (ASSUMED) ---
// You will need to add these buttons to your HTML:
// <button id="btn-log-before">1. Log Before State</button>
// <button id="btn-log-after">2. Log After & Compare</button>

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

// ===== Rendering, Data Fetch, OAuth (UNCHANGED) =====
// ... (omitted for brevity, assume renderLists and fetchData are unchanged)

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

// ===== NEW DEBUGGING FUNCTIONS =====

/**
 * Helper to log a task object clearly.
 * @param {object} task The task object.
 * @param {string} label Label for the console log.
 */
function dumpTaskToConsole(task, label) {
    const relevantKeys = ['id', 'content', 'project_id', 'parent_id', 'indent', 'order', 'section_id'];
    const logData = {};
    relevantKeys.forEach(key => {
        logData[key] = task[key];
    });
    console.log(`\n--- [DEBUG] ${label} Task ID ${task.id} ---`);
    console.table(logData);
    console.log(`--- FULL OBJECT ---`, task);
    console.log(`\n----------------------------------------------------`);
}

/**
 * Logs the "Before" state of the selected left task and stores it.
 */
async function logBefore() {
    if (!selectedLeftId) {
        alert("Please select a task on the left first.");
        return;
    }
    const left = await callTodoist(`/tasks/${selectedLeftId}`, { method: 'GET' });
    if (left) {
        // Use JSON parsing to deep clone the object, preventing accidental modification
        taskSnapshotBefore = JSON.parse(JSON.stringify(left)); 
        dumpTaskToConsole(taskSnapshotBefore, "BEFORE STATE");
        alert("BEFORE state logged to console. Now, go manually change the task in Todoist.");
    }
}

/**
 * Logs the "After" state of the selected left task and compares it to the "Before" state.
 */
async function logAfterAndCompare() {
    if (!selectedLeftId) {
        alert("Please select a task on the left first.");
        return;
    }
    if (!taskSnapshotBefore) {
        alert("Please hit the '1. Log Before State' button first.");
        return;
    }

    const leftAfter = await callTodoist(`/tasks/${selectedLeftId}`, { method: 'GET' });
    if (leftAfter) {
        dumpTaskToConsole(leftAfter, "AFTER STATE (Manual Change)");
        compareTasks(taskSnapshotBefore, leftAfter);
    }
}

/**
 * Compares two task objects and logs the differences.
 * @param {object} before The task object before the change.
 * @param {object} after The task object after the change.
 */
function compareTasks(before, after) {
    const changes = {};
    const keys = Object.keys(before);
    let changedCount = 0;

    console.log("\n--- [DEBUG] DIFFERENCES (Before vs. After) ---");
    
    keys.forEach(key => {
        const valBefore = before[key];
        const valAfter = after[key];
        
        // Simple comparison, ignoring deep object differences for now (like 'due')
        if (key !== 'due' && JSON.stringify(valBefore) !== JSON.stringify(valAfter)) {
            changes[key] = {
                before: valBefore,
                after: valAfter,
                notes: `--- REQUIRED FIELD ---`
            };
            changedCount++;
        } 
        // Handle "due" object changes (simplified check)
        else if (key === 'due' && JSON.stringify(valBefore) !== JSON.stringify(valAfter)) {
             changes[key] = {
                before: valBefore,
                after: valAfter,
                notes: `--- 'due' field changed (Check details above) ---`
            };
            changedCount++;
        }
    });

    if (changedCount > 0) {
        console.log(`\n✅ FOUND ${changedCount} REQUIRED CHANGE(S):`);
        console.table(changes);
        console.log("These are the minimum fields that MUST be included in the Step 2 API update!");
    } else {
        console.log("\n❌ NO SIGNIFICANT CHANGES DETECTED. The task structure may be the same.");
    }
    console.log("----------------------------------------------------");
}


// ===== WORKFLOW LOGIC (PREVIOUSLY ATTEMPTED FIXES REMOVED) =====

async function performMove() {
  if (!selectedLeftId || !selectedRightId) return;

  const left = todayTasks.find(t => t.id === selectedLeftId);
  const right = allTasks.find(t => t.id === selectedRightId);

  if (!left || !right || left.id === right.id) {
    moveStatus.textContent = 'Invalid selection';
    return;
  }

  btnMove.disabled = true;
  moveStatus.textContent = 'Step 1: Moving to project...';

  try {
    // STEP 1: Move left task to right's project using SYNC API
    console.log('[move] STEP 1: Moving task to project', right.project_id);
    await fetch('https://api.todoist.com/sync/v9/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sync_token: '*',
        resource_types: '["projects","items"]',
        commands: [{
          type: 'item_move',
          uuid: crypto.randomUUID(),
          args: {
            id: parseInt(left.id),
            project_id: parseInt(right.project_id)
          }
        }]
      })
    });

    moveStatus.textContent = 'Step 2: Making subtask...';

    // STEP 2: Setting parent_id with previous attempts' best guess (indent/order)
    // NOTE: This part remains based on the best guess until you provide the diff log
    console.log('[move] STEP 2: Attempting to set parent_id, indent: 2, and content.');
    await callTodoist(`/tasks/${left.id}`, {
      method: 'POST',
      body: JSON.stringify({
        parent_id: right.id,
        content: left.content, 
        indent: 2, 
        order: 1 
      })
    });

    // Find and move children (if any)
    const allTasksFlat = [...todayTasks, ...allTasks];
    const byId = {};
    allTasksFlat.forEach(t => byId[t.id] = t);

    const children = allTasksFlat.filter(task => {
      let current = task;
      while (current.parent_id) {
        if (current.parent_id === left.id) return true;
        current = byId[current.parent_id];
        if (!current) break;
      }
      return false;
    });

    for (const child of children) {
      // Move child to same project (SYNC API)
      await fetch('https://api.todoist.com/sync/v9/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sync_token: '*',
          resource_types: '["projects","items"]',
          commands: [{
            type: 'item_move',
            uuid: crypto.randomUUID(),
            args: {
              id: parseInt(child.id),
              project_id: parseInt(right.project_id)
            }
          }]
        })
      });

      // Set child parent to left task (REST API)
      await callTodoist(`/tasks/${child.id}`, {
        method: 'POST',
        body: JSON.stringify({
          parent_id: left.id,
          content: child.content,
          indent: 3, 
          order: 1
        })
      });
    }

    moveStatus.textContent = '✅ Moved as subtask! Refreshing...';
    setTimeout(fetchData, 1500);
  } catch (err) {
    console.error('[move] Error:', err);
    moveStatus.textContent = '❌ ' + err.message;
  } finally {
    btnMove.disabled = false;
  }
}

// ===== OAuth flow (UNCHANGED) =====
// ... (omitted for brevity, OAuth code remains the same)
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
    // Assuming you have buttons with these IDs:
    document.getElementById('btn-log-before')?.addEventListener('click', logBefore);
    document.getElementById('btn-log-after')?.addEventListener('click', logAfterAndCompare);
  } catch (err) {
    todayStatus.textContent = 'Failed to load tasks.';
    allStatus.textContent = 'Failed to load tasks.';
    console.error('[data] Initial load failed:', err);
  }
}

// ===== Event wiring (UNCHANGED) =====

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
  await handleOAuthRedirect();
  if (hasToken()) {
    console.log('[init] Token already present, showing app.');
    showApp();
  } else {
    console.log('[init] No token yet, waiting for auth.');
  }
});
