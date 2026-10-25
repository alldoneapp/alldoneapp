'use strict'

// The live data bridge (ARTIFACTS_PLAN.md §7, idea 1): a dashboard that asks Alldone for its
// numbers when it is viewed, instead of baking in the data its author could see.
//
// How it fits together:
//   - The artifact loads `_alldone/bridge.js` (served by serveArtifact, not stored with the
//     artifact) and calls `alldone.tasks({ status: 'done' })` and friends.
//   - The script posts the question to the window around it. Inside Alldone that is the app, which
//     answers from a fixed, read-only set of queries with the VIEWER's own Firestore client and
//     permissions, and only ever with objects the whole project can see (never anybody's private
//     items, not even the viewer's own).
//   - The app frames a data-bound artifact with `?alldone-bridge=1`, and serveArtifact answers that
//     address with a locked-down policy: no network requests, no forms, no popups, no frames, and
//     scripts only from this origin and three public CDNs. Data handed to the page therefore has no
//     silent way out. The policy is decided by the address, not by the artifact document, so a
//     cached response from before the switch can never be the one that receives data.
//   - Only the artifact's owner switches it on (`dataAccess`, a server-owned field).
//
// What remains possible, and is why the bridge is opt-in and limited to project-shared objects: a
// page can still navigate its own frame to another address (the app stops answering a frame the
// moment it has navigated, but that navigation itself can carry data in its URL), and browsers do
// not let a page policy stop WebRTC or DNS prefetching. Treat a data-bound artifact like code with
// read access to what every project member can see.

const ARTIFACT_BRIDGE_QUERY_PARAM = 'alldone-bridge'
const ARTIFACT_BRIDGE_SCRIPT_PATH = '_alldone/bridge.js'
const ARTIFACT_BRIDGE_PROTOCOL = 'alldone-bridge-v1'
// The iframe's own sandbox for a data-bound artifact: scripts, and nothing else.
const ARTIFACT_BRIDGE_SANDBOX = 'allow-scripts'

const BRIDGE_SCRIPT_HOSTS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']
const ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY = [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${BRIDGE_SCRIPT_HOSTS.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${BRIDGE_SCRIPT_HOSTS.join(' ')} https://fonts.googleapis.com`,
    `font-src 'self' data: ${BRIDGE_SCRIPT_HOSTS.join(' ')} https://fonts.gstatic.com`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
].join('; ')

const BRIDGE_QUERY_NAMES = ['project', 'members', 'tasks', 'goals']
const BRIDGE_LIMITS = Object.freeze({
    defaultTasks: 100,
    maxTasks: 500,
    maxGoals: 200,
    maxSinceDays: 366,
    queriesPerMinute: 30,
    cacheMs: 30 * 1000,
})

function isBridgeScriptPath(path) {
    const value = String(path || '')
    return value === ARTIFACT_BRIDGE_SCRIPT_PATH || value.endsWith(`/${ARTIFACT_BRIDGE_SCRIPT_PATH}`)
}

function clampInteger(value, min, max, fallback) {
    const number = Math.floor(Number(value))
    if (!Number.isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
}

// A page opens the conversation once, with a hello, and gets a session token back; every question
// carries it. A second hello from the same frame means a second document — the page navigated or
// reloaded — and ends the conversation for good, because the scripts of a newly loaded document run
// before the frame reports that it loaded, so counting loads alone would answer the new page.
function isBridgeHello(message) {
    return !!message && message.protocol === ARTIFACT_BRIDGE_PROTOCOL && message.type === 'hello'
}

// A question from a page, made safe to answer: a known query name and only the parameters that
// query takes, clamped to its limits. Anything else is an error the page can show.
function normalizeBridgeQuery(message) {
    if (!message || message.protocol !== ARTIFACT_BRIDGE_PROTOCOL || message.type !== 'query') return null
    const id = typeof message.id === 'string' ? message.id.slice(0, 64) : ''
    if (!id) return null
    const session = typeof message.session === 'string' ? message.session : ''
    const name = message.name
    if (!BRIDGE_QUERY_NAMES.includes(name))
        return { id, session, error: `Unknown query "${String(name).slice(0, 40)}".` }
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    if (name === 'tasks') {
        const status = params.status === 'done' ? 'done' : 'open'
        const query = {
            status,
            limit: clampInteger(params.limit, 1, BRIDGE_LIMITS.maxTasks, BRIDGE_LIMITS.defaultTasks),
        }
        if (status === 'done' && params.sinceDays !== undefined) {
            query.sinceDays = clampInteger(params.sinceDays, 1, BRIDGE_LIMITS.maxSinceDays, 30)
        }
        return { id, session, name, params: query }
    }
    return { id, session, name, params: {} }
}

// What the page sees of a task or a goal: enough for a chart, nothing about who may read it.
function toBridgeTask(id, data = {}) {
    return {
        id,
        title: String(data.extendedName || data.name || ''),
        done: data.done === true,
        created: Number(data.created) || null,
        completed: Number(data.completed) || null,
        dueDate: Number(data.dueDate) || null,
        // The estimate of the task's open step (OPEN_STEP = -1), in the project's estimation unit.
        estimation: Number(data.estimations?.['-1']) || 0,
        assigneeId: data.userId || null,
        goalId: data.parentGoalId || null,
    }
}

function toBridgeGoal(id, data = {}) {
    return {
        id,
        title: String(data.extendedName || data.name || ''),
        progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : null,
        assigneeIds: Array.isArray(data.assigneesIds) ? data.assigneesIds : [],
        startDate: Number(data.startingMilestoneDate) || null,
        endDate: Number(data.completionMilestoneDate) || null,
    }
}

// Shared with the whole project: the only objects the bridge ever hands to a page.
function isProjectShared(data = {}) {
    return Array.isArray(data.readerIds) && data.readerIds.some(readerId => readerId === 0 || readerId === '0')
}

// The script a data-bound artifact loads. Plain ES5 so it runs in whatever a model writes around it.
const ARTIFACT_BRIDGE_SCRIPT = `(function () {
  var PROTOCOL = '${ARTIFACT_BRIDGE_PROTOCOL}';
  var inAlldone = window.parent && window.parent !== window;
  var NO_ANSWER = 'Alldone did not answer. Live data may be switched off for this artifact.';
  var pending = {};
  var counter = 0;
  var welcome = null;
  var session = new Promise(function (resolve, reject) {
    if (!inAlldone) return reject(new Error('Live Alldone data is only available when this page is opened inside Alldone.'));
    welcome = resolve;
    window.parent.postMessage({ protocol: PROTOCOL, type: 'hello' }, '*');
    setTimeout(function () { reject(new Error(NO_ANSWER)); }, 15000);
  });
  session.catch(function () {});
  function ask(name, params) {
    return session.then(function (token) {
      return new Promise(function (resolve, reject) {
        var id = 'q' + (++counter) + '-' + Date.now();
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ protocol: PROTOCOL, type: 'query', id: id, session: token, name: name, params: params || {} }, '*');
        setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error(NO_ANSWER));
        }, 15000);
      });
    });
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.protocol !== PROTOCOL) return;
    if (data.type === 'welcome' && welcome) { welcome(String(data.session)); welcome = null; return; }
    if (data.type !== 'result' || !pending[data.id]) return;
    var request = pending[data.id];
    delete pending[data.id];
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  window.alldone = {
    available: inAlldone,
    project: function () { return ask('project'); },
    members: function () { return ask('members'); },
    tasks: function (params) { return ask('tasks', params); },
    goals: function () { return ask('goals'); }
  };
})();
`

module.exports = {
    ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY,
    ARTIFACT_BRIDGE_PROTOCOL,
    ARTIFACT_BRIDGE_QUERY_PARAM,
    ARTIFACT_BRIDGE_SANDBOX,
    ARTIFACT_BRIDGE_SCRIPT,
    ARTIFACT_BRIDGE_SCRIPT_PATH,
    BRIDGE_LIMITS,
    BRIDGE_QUERY_NAMES,
    isBridgeHello,
    isBridgeScriptPath,
    isProjectShared,
    normalizeBridgeQuery,
    toBridgeGoal,
    toBridgeTask,
}
