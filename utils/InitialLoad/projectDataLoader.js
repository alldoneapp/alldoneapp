/**
 * AT-2386 — per-project, on-demand loading of the four per-project collections
 * (users, contacts, workstreams, assistants).
 *
 * WHAT WAS WRONG
 * --------------
 * These four were the last per-project collections still loaded by the LOGIN bundle. For every
 * project in `loggedUser.projectIds`, `loadProjectsDataFromFirebase` awaited four collection
 * reads, and `watchProjectData` then armed four permanent `onSnapshot` listeners — before the
 * first frame, whether or not anything on screen needed any of it.
 *
 * Measured on the reporting account (production, 2026-08-20): 14 projects x 4 collections = 56
 * collection reads awaited by login, of which the contacts alone were 523 documents (one project
 * holds 219). All of it was then `JSON.stringify`'d into the 24h `UserDataCache` localStorage
 * payload and deep-compared with `isEqual` on every subsequent login.
 *
 * Note what was NOT wrong, because it changes what this module has to do: the load was already
 * scoped to ACTIVE projects. `updateInactiveProjectsData` (redux/store.js) strips guides,
 * templates and archived ids out of `loggedUser.projectIds` before InitialLoad reads them — 14 of
 * the account's 140 project ids survive. So "only load from active projects" was already true, as
 * a side effect of that reducer rather than by design; `projectDataScope.test.js` now states it.
 *
 * And @-mentions — the reason the eager load was believed to be necessary — never used this data.
 * `MentionsModal.getMentions` searches Typesense across every project the user can see, a contact
 * picked from another project is COPIED into the current one (`copyContactToProject`, so a stored
 * mention's userId always belongs to the object's own project), and Quill mention chips open
 * their own single-document watcher (`MentionWrapper`). Redux only ever served rendering.
 *
 * WHAT THIS DOES
 * --------------
 * These collections now follow the lifecycle tasks, notes and goals already use: whoever renders
 * them asks for them. `ensureProjectDataLoaded(projectId)` is idempotent and arms ONE live
 * watcher per (project, kind), whose first snapshot fills redux. There is no separate one-shot
 * fetch: with Firestore IndexedDB persistence enabled the cached snapshot arrives immediately
 * anyway, and a single code path cannot disagree with itself.
 *
 * It returns a promise that settles when every requested kind has delivered its first snapshot,
 * because two boot-time decisions genuinely need the data before they run:
 *   - `TasksHelper.processURLProjectsUserTasks` resolves a `/projects/<id>/user/<uid>/tasks` deep
 *     link by looking the target user up in `projectUsers[projectId]`; routing early would bounce
 *     a colleague's board to "All projects",
 *   - `getDefaultAssistant` reads `projectAssistants[defaultProjectId]`.
 * That promise is bounded by `FIRST_SNAPSHOT_TIMEOUT_MS` — a wedged stream must never be able to
 * hang login (the degraded-boot lesson from `bootIntegrityHealer`).
 *
 * THE INVARIANT THAT MAKES THIS SAFE
 * ----------------------------------
 * `state.projectUsers[projectId]` and friends must stay ARRAYS for every project in redux, loaded
 * or not. A dozen call sites read them without a guard (`GoalsBacklog`, `MilestoneItem`,
 * `GoalsHelper.getAssigneesIdsToShowInBoard`, the three assignee modals, `TasksBoards`,
 * `ContactProperties`, `ContactsHelper.updateContactLastVisitedBoardDate`), and a missing key
 * there is a crash, not a blank. InitialLoad therefore still seeds `[]` for every project; only
 * the CONTENT is deferred.
 *
 * "Loaded" is tracked here rather than in redux: with fill-in-silently rendering no component
 * needs to show a loading state for it, so keeping it out of the store means deferring this data
 * adds zero extra store churn (AT-2336).
 *
 * WHY A LOOKUP MISS LOADS THE PROJECT
 * -----------------------------------
 * ~30 render sites resolve a name/photo through synchronous funnels
 * (`TasksHelper.getContactInProject`, `getUserInProject`, ...). Wiring an explicit `ensure` into
 * each is 30 chances to miss one, and the failure is silent — a row renders
 * `getUnknownUserData()` and nobody notices. So the funnels report their own miss here. The hot
 * path is one `Map.has`; an unloaded project triggers at most ONE load however many rows miss it,
 * because the state is recorded before the watcher is armed.
 *
 * DELIBERATELY NOT DONE: eviction. The watcher count is bounded by the projects redux knows
 * about, which `updateInactiveProjectsData` has already capped at the active set. An LRU would
 * add flicker risk — evicting a project still on screen empties its slice — to fix a problem that
 * cannot occur here.
 */

import store from '../../redux/store'
import {
    setAssistantsInProject,
    setContactsInProject,
    setUsersInProject,
    setWorkstreamsInProject,
} from '../../redux/actions'

export const PROJECT_DATA_USERS = 'users'
export const PROJECT_DATA_CONTACTS = 'contacts'
export const PROJECT_DATA_WORKSTREAMS = 'workstreams'
export const PROJECT_DATA_ASSISTANTS = 'assistants'

export const ALL_PROJECT_DATA_KINDS = [
    PROJECT_DATA_USERS,
    PROJECT_DATA_CONTACTS,
    PROJECT_DATA_WORKSTREAMS,
    PROJECT_DATA_ASSISTANTS,
]

/**
 * Upper bound on how long `ensureProjectDataLoaded` may keep login waiting for a first snapshot.
 * The watcher is NOT cancelled on timeout — it stays armed and fills redux whenever it delivers;
 * only the promise stops blocking.
 */
export const FIRST_SNAPSHOT_TIMEOUT_MS = 8000

/** Gap between background warm-up loads, mirroring the existing 50ms watcher stagger. */
export const WARM_UP_STAGGER_MS = 50

const KIND_DESCRIPTORS = {
    [PROJECT_DATA_USERS]: {
        watcherKey: projectId => `${projectId}Users`,
        watch: (projectId, watcherKey, callback) =>
            require('../backends/Users/usersFirestore').watchProjectUsers(projectId, callback, watcherKey),
        // Preserved from the original `updateUsers`: an empty snapshot is not written. A project
        // always has at least its owner, so `[]` here means a degraded read, and overwriting a
        // good list with it would strip every avatar in that project.
        apply: (projectId, users) => {
            if (Array.isArray(users) && users.length > 0) store.dispatch(setUsersInProject(projectId, users))
        },
    },
    [PROJECT_DATA_CONTACTS]: {
        watcherKey: projectId => `${projectId}Contacts`,
        watch: (projectId, watcherKey, callback) =>
            require('../backends/Contacts/contactsFirestore').watchProjectContacts(projectId, callback, watcherKey),
        apply: (projectId, contacts) => store.dispatch(setContactsInProject(projectId, contacts)),
    },
    [PROJECT_DATA_WORKSTREAMS]: {
        watcherKey: projectId => `${projectId}Workstreams`,
        watch: (projectId, watcherKey, callback) =>
            require('../backends/Workstreams/workstreamsFirestore').watchProjectWorkstreams(
                projectId,
                callback,
                watcherKey
            ),
        apply: (projectId, workstreams) => store.dispatch(setWorkstreamsInProject(projectId, workstreams)),
    },
    [PROJECT_DATA_ASSISTANTS]: {
        watcherKey: projectId => `${projectId}Assistants`,
        // Note the argument order: `watchAssistants(projectId, watcherKey, callback)`.
        watch: (projectId, watcherKey, callback) =>
            require('../backends/Assistants/assistantsFirestore').watchAssistants(projectId, watcherKey, callback),
        apply: (projectId, assistants) => store.dispatch(setAssistantsInProject(projectId, assistants)),
    },
}

/** `${projectId}:${kind}` -> { loaded: boolean, promise: Promise<boolean> } */
const entries = new Map()

const entryKey = (projectId, kind) => `${projectId}:${kind}`

const normalizeKinds = kinds => {
    if (!kinds) return ALL_PROJECT_DATA_KINDS
    const list = Array.isArray(kinds) ? kinds : [kinds]
    const valid = list.filter(kind => !!KIND_DESCRIPTORS[kind])
    return valid.length > 0 ? valid : ALL_PROJECT_DATA_KINDS
}

export const getProjectDataWatcherKey = (projectId, kind) => {
    const descriptor = KIND_DESCRIPTORS[kind]
    return descriptor ? descriptor.watcherKey(projectId) : null
}

export const isProjectDataRequested = (projectId, kind) => entries.has(entryKey(projectId, kind))

export const isProjectDataLoaded = (projectId, kind) => {
    const entry = entries.get(entryKey(projectId, kind))
    return !!entry && entry.loaded
}

export const areProjectContactsLoaded = projectId => isProjectDataLoaded(projectId, PROJECT_DATA_CONTACTS)

export const getRequestedProjectDataKeys = () => Array.from(entries.keys())

/**
 * Arms one watcher for one (project, kind) unless it is already armed.
 * Resolves `true` once the first snapshot has been applied, `false` on timeout or failure.
 *
 * Never throws: it is reachable from render paths where a rejection would take a list down.
 */
function ensureOneKind(projectId, kind) {
    const key = entryKey(projectId, kind)
    const existing = entries.get(key)
    if (existing) return existing.promise

    const descriptor = KIND_DESCRIPTORS[kind]
    if (!descriptor) return Promise.resolve(false)

    const entry = { loaded: false, promise: null }
    let settle = () => {}
    entry.promise = new Promise(resolve => {
        settle = resolve
    })
    // Recorded BEFORE the watcher is armed so a burst of lookup misses in the same frame cannot
    // arm the same watcher twice.
    entries.set(key, entry)

    let timeoutId = setTimeout(() => {
        timeoutId = null
        // The watcher stays armed on purpose - it will still fill redux when it eventually
        // delivers. Only the promise stops blocking whoever awaited it.
        console.warn(`[InitialLoad] ${kind} of project ${projectId} did not arrive within the first-snapshot budget`)
        settle(false)
    }, FIRST_SNAPSHOT_TIMEOUT_MS)

    const clearPendingTimeout = () => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId)
            timeoutId = null
        }
    }

    const fail = error => {
        clearPendingTimeout()
        // Forget it so a later render or the next sweep can retry.
        entries.delete(key)
        console.warn(`[InitialLoad] Failed to watch ${kind} of project ${projectId}:`, error)
        settle(false)
    }

    try {
        const result = descriptor.watch(projectId, descriptor.watcherKey(projectId), data => {
            try {
                descriptor.apply(projectId, data)
            } catch (error) {
                console.warn(`[InitialLoad] Failed to store ${kind} of project ${projectId}:`, error)
            }
            entry.loaded = true
            clearPendingTimeout()
            settle(true)
        })

        // These watchers are declared `async`, so a synchronous throw inside one surfaces as a
        // rejected promise rather than an exception here.
        if (result && typeof result.catch === 'function') result.catch(fail)
    } catch (error) {
        fail(error)
    }

    return entry.promise
}

/**
 * Ensures some or all per-project collections for one project.
 * Resolves when every requested kind has delivered its first snapshot (or timed out).
 */
export function ensureProjectDataLoaded(projectId, kinds) {
    if (!projectId || typeof projectId !== 'string') return Promise.resolve(false)
    const requested = normalizeKinds(kinds)
    return Promise.all(requested.map(kind => ensureOneKind(projectId, kind))).then(results => results.every(Boolean))
}

/** Same, for a list of projects, all started immediately and in parallel. */
export function ensureProjectsDataLoaded(projectIds, kinds) {
    if (!Array.isArray(projectIds) || projectIds.length === 0) return Promise.resolve(true)
    return Promise.all(projectIds.map(projectId => ensureProjectDataLoaded(projectId, kinds))).then(results =>
        results.every(Boolean)
    )
}

/**
 * Requests data because a lookup could not be resolved from redux.
 *
 * Restricted to projects redux already knows about: an id from an old mention, a copied task or a
 * deleted project must never be able to arm an unbounded number of watchers. Fire-and-forget.
 */
export function requestProjectDataOnLookupMiss(projectId, kind) {
    if (!projectId) return false
    const requested = normalizeKinds(kind)
    // Fast path first - this runs inside render for every unresolved row.
    if (requested.every(one => entries.has(entryKey(projectId, one)))) return false

    const { loggedUserProjectsMap } = store.getState()
    if (!loggedUserProjectsMap || !loggedUserProjectsMap[projectId]) return false

    ensureProjectDataLoaded(projectId, requested)
    return true
}

/**
 * Background sweep over the projects that were not in the priority set.
 *
 * Staggered rather than fired at once, matching the existing `watchProjectsData` behaviour: the
 * point is to stay out of the way of the first paint, not to race it. Returns a cancel function
 * so a logout or project-list change can stop a sweep in flight.
 */
export function warmProjectsData(projectIds, { staggerMs = WARM_UP_STAGGER_MS, kinds } = {}) {
    const ids = Array.isArray(projectIds) ? projectIds : []
    const timeouts = []
    let cancelled = false

    ids.forEach((projectId, index) => {
        timeouts.push(
            setTimeout(() => {
                if (cancelled) return
                ensureProjectDataLoaded(projectId, kinds)
            }, index * staggerMs)
        )
    })

    return () => {
        cancelled = true
        timeouts.forEach(clearTimeout)
    }
}

/**
 * Drops the recorded state WITHOUT touching the watchers, for callers that unsubscribe
 * themselves. `unwatchProjectData` already unwatches all four keys, so it only needs this half;
 * forgetting is what lets a re-added project load again.
 */
export function forgetProjectData(projectId) {
    let removed = false
    ALL_PROJECT_DATA_KINDS.forEach(kind => {
        if (entries.delete(entryKey(projectId, kind))) removed = true
    })
    return removed
}

export function forgetAllProjectData() {
    entries.clear()
}

export function resetProjectDataLoaderForTests() {
    entries.clear()
}
