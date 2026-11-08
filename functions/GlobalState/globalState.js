const { AsyncLocalStorage } = require('async_hooks')

// Security audit 2026-11: this state used to live ONLY in the module-level object below, which every
// loadFeedsGlobalState call overwrites. A gen2 function serves up to 80 requests in one process, so
// an invocation that loaded its state, awaited I/O and then read it again (a guide copy reads it
// after copying note bodies and photos) could read ANOTHER request's feed creator, project and
// member list, and make that other user a follower of its guide's tasks. Code that runs inside
// runWithFeedsState gets a store of its own for the whole invocation, carried across awaits by
// AsyncLocalStorage, and never sees the shared object. Callers that do not opt in keep the old
// process-wide behaviour.
const globalState = {}
const invocationState = new AsyncLocalStorage()

function currentStore() {
    return invocationState.getStore() || globalState
}

function setGlobalState(key, value) {
    currentStore()[key] = value
}

function getGlobalState() {
    return { ...currentStore() }
}

function loadFeedsGlobalState(admin, appAdmin, feedCreator, project, users, templateCreator) {
    setGlobalState('admin', admin)
    setGlobalState('appAdmin', appAdmin)
    setGlobalState('feedCreator', feedCreator)
    setGlobalState('project', project)
    setGlobalState('users', users)
    setGlobalState('templateCreator', templateCreator)
}

/** Runs fn with feed state private to this invocation (starts empty, ends with fn). */
function runWithFeedsState(fn) {
    return invocationState.run({}, fn)
}

module.exports = { getGlobalState, loadFeedsGlobalState, runWithFeedsState }
