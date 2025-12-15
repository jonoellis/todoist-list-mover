const TODOIST_TOKEN_KEY = "todoistToken";
const TASK_LEFT_KEY = "taskLeft";
const TASK_RIGHT_KEY = "taskRight";
const API_BASE_URL = "https://api.todoist.com/rest/v2";

const ui = {};
let leftTask = null;
let rightTask = null;

// --- Todoist API interaction ---

/**
 * Calls the Todoist API with the given endpoint, method, and body.
 * @param {string} endpoint The API endpoint (e.g., '/tasks').
 * @param {string} method The HTTP method (e.g., 'GET', 'POST').
 * @param {object} body The request body object (optional).
 * @returns {Promise<object>} The JSON response from the API.
 */
async function callTodoist(endpoint, method, body) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = localStorage.getItem(TODOIST_TOKEN_KEY);
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const options = {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : null
    };

    console.log(`[todoist] Request: ${url} ${options.method} ${options.body || ''}`);

    const response = await fetch(url, options);

    console.log(`[todoist] Response: ${url} ${response.status}`);

    if (response.ok) {
        if (response.status === 204) {
            return {}; // No content for successful POST/DELETE
        }
        return response.json();
    } else {
        const errorText = await response.text();
        console.error(`[todoist] Response: ${url} ${response.status} ${errorText}`);
        throw new Error(`Todoist error ${response.status}: ${errorText}`);
    }
}

/**
 * Fetches a task by ID.
 * @param {string} taskId The ID of the task.
 * @returns {Promise<object>} The task object.
 */
async function getTask(taskId) {
    if (!taskId) return null;
    try {
        const task = await callTodoist(`/tasks/${taskId}`, 'GET');
        console.log(`[todoist] Fetched task: ${task.id} ${task.content}`);
        return task;
    } catch (error) {
        console.error(`[todoist] Error fetching task ${taskId}:`, error);
        return null;
    }
}

// --- UI initialization and Task selection ---

/**
 * Initializes the UI elements and event listeners.
 */
function initUI() {
    ui.tokenInput = document.getElementById('tokenInput');
    ui.tokenSave = document.getElementById('tokenSave');
    ui.taskLeftInput = document.getElementById('taskLeftInput');
    ui.taskRightInput = document.getElementById('taskRightInput');
    ui.loadTasksButton = document.getElementById('loadTasksButton');
    ui.taskLeftDisplay = document.getElementById('taskLeftDisplay');
    ui.taskRightDisplay = document.getElementById('taskRightDisplay');
    ui.moveButton = document.getElementById('moveButton');

    // Load saved token and task IDs
    ui.tokenInput.value = localStorage.getItem(TODOIST_TOKEN_KEY) || '';
    ui.taskLeftInput.value = localStorage.getItem(TASK_LEFT_KEY) || '';
    ui.taskRightInput.value = localStorage.getItem(TASK_RIGHT_KEY) || '';

    // Event listeners
    ui.tokenSave.addEventListener('click', saveToken);
    ui.loadTasksButton.addEventListener('click', loadTasks);
    ui.moveButton.addEventListener('click', performMove);

    // Initial load
    if (ui.tokenInput.value) {
        loadTasks();
    }
}

/**
 * Saves the Todoist API token to local storage.
 */
function saveToken() {
    const token = ui.tokenInput.value.trim();
    if (token) {
        localStorage.setItem(TODOIST_TOKEN_KEY, token);
        alert('Token saved!');
    } else {
        localStorage.removeItem(TODOIST_TOKEN_KEY);
        alert('Token cleared!');
    }
}

/**
 * Cleans the task ID from a Todoist URL or full task ID string.
 * @param {string} input The user input string.
 * @returns {string} The cleaned task ID.
 */
function cleanTaskId(input) {
    if (!input) return '';
    const match = input.match(/\/tasks\/(\d+)/) || input.match(/id=(\d+)/);
    return match ? match[1] : input.trim();
}

/**
 * Loads tasks based on the input IDs.
 */
async function loadTasks() {
    const token = localStorage.getItem(TODOIST_TOKEN_KEY);
    if (!token) {
        alert("Please save your Todoist API token first.");
        return;
    }

    const leftId = cleanTaskId(ui.taskLeftInput.value);
    const rightId = cleanTaskId(ui.taskRightInput.value);

    localStorage.setItem(TASK_LEFT_KEY, ui.taskLeftInput.value);
    localStorage.setItem(TASK_RIGHT_KEY, ui.taskRightInput.value);

    // Fetch and set left task
    leftTask = await getTask(leftId);
    if (leftTask) {
        console.log(`[ui] Selected left task: ${leftTask.id}`, leftTask);
        ui.taskLeftDisplay.innerHTML = `**Task: ${leftTask.content}**<br>Project ID: ${leftTask.project_id}<br>Parent ID: ${leftTask.parent_id || 'None'}`;
    } else {
        ui.taskLeftDisplay.innerHTML = `*Task ${leftId} not found or invalid ID.*`;
    }

    // Fetch and set right task
    rightTask = await getTask(rightId);
    if (rightTask) {
        console.log(`[ui] Selected right task: ${rightTask.id}`, rightTask);
        ui.taskRightDisplay.innerHTML = `**Task: ${rightTask.content}**<br>Project ID: ${rightTask.project_id}<br>Parent ID: ${rightTask.parent_id || 'None'}`;
    } else {
        ui.taskRightDisplay.innerHTML = `*Task ${rightId} not found or invalid ID.*`;
    }

    // Enable move button if both tasks are loaded
    ui.moveButton.disabled = !(leftTask && rightTask);
}

// --- Workflow logic ---

/**
 * Performs the task move workflow:
 * 1. Move leftTask to rightTask's project.
 * 2. Set leftTask's parent_id to rightTask's ID.
 */
async function performMove() {
    console.log('[ui] Move clicked.');
    if (!leftTask || !rightTask) {
        alert("Please load both tasks first.");
        return;
    }

    if (leftTask.id === rightTask.id) {
        alert("Cannot move a task to itself.");
        return;
    }

    ui.moveButton.disabled = true;

    try {
        // --- STEP 1: Change project to match right task's project ---
        console.log(`[move] STEP 1: Moving task to project ${rightTask.project_id}`);
        await callTodoist(`/tasks/${leftTask.id}`, 'POST', {
            project_id: rightTask.project_id
        });
        console.log(`[move] STEP 1: Project updated successfully.`);

        // --- STEP 2: Set parent_id to rightTask's ID ---
        console.log(`[move] STEP 2: Setting parent_id to ${rightTask.id}`);
        
        // ** FIX APPLIED HERE **
        // To satisfy the Todoist API's requirement that an update request 
        // must contain at least one supported field other than just parent_id,
        // we re-send the project_id (which was set in Step 1).
        await callTodoist(`/tasks/${leftTask.id}`, 'POST', {
            parent_id: rightTask.id,
            project_id: rightTask.project_id // Included to ensure API accepts the request
        });
        
        console.log(`[move] STEP 2: Parent updated successfully. Task ${leftTask.id} is now a subtask of ${rightTask.id}`);

        alert("Task move successful! Please reload tasks to verify.");
        await loadTasks(); // Reload to show the new state

    } catch (error) {
        console.error('[move] Error:', error);
        alert(`Move failed. Check console for details. Error: ${error.message}`);
    } finally {
        ui.moveButton.disabled = false;
    }
}

// --- Initialization ---

window.onload = initUI;
