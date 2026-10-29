import store from '../../redux/store'
import { getDb } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'

// Opening an activity row (AT-2906). Every detail route of the app answers a target it cannot show
// by silently landing on "All projects" (`navigateToAllProjectsTasks`), and the Anna workspace
// cannot tell that apart from success — so a deleted task, a project the user left, or a thread
// whose type was never saved looked like a click that "sometimes opens the wrong thing". The row
// therefore checks its target first, read-only, and either hands the router a path it can open or
// says why it cannot. A failed check that is NOT an answer (offline, a transient error) does not
// block: the router then decides as it always did.

const id = '[a-zA-Z0-9_-]+'
const ROUTES = [
    { type: 'tasks', pattern: new RegExp(`^/projects/(${id})/tasks/(${id})/(properties|chat)$`) },
    { type: 'goals', pattern: new RegExp(`^/projects/(${id})/goals/(${id})/(properties|chat)$`) },
    { type: 'notes', pattern: new RegExp(`^/projects/(${id})/notes/(${id})/editor$`) },
    { type: 'contacts', pattern: new RegExp(`^/projects/(${id})/contacts/(${id})/properties$`) },
    { type: 'chats', pattern: new RegExp(`^/projects/(${id})/chats/(${id})/chat$`) },
]

const DOCS = {
    tasks: (projectId, objectId) => `items/${projectId}/tasks/${objectId}`,
    goals: (projectId, objectId) => `goals/${projectId}/items/${objectId}`,
    notes: (projectId, objectId) => `noteItems/${projectId}/notes/${objectId}`,
    contacts: (projectId, objectId) => `projectsContacts/${projectId}/contacts/${objectId}`,
    chats: (projectId, chatId) => `chatObjects/${projectId}/chats/${chatId}`,
}

// Where a thread's chat lives once its type is known; mirrors `getAnnaActivityTarget`.
const CHAT_TARGETS = {
    tasks: (projectId, objectId) => `/projects/${projectId}/tasks/${objectId}/chat`,
    goals: (projectId, objectId) => `/projects/${projectId}/goals/${objectId}/chat`,
    notes: (projectId, objectId) => `/projects/${projectId}/notes/${objectId}/editor`,
    contacts: (projectId, objectId) => `/projects/${projectId}/contacts/${objectId}/properties`,
    topics: (projectId, chatId) => `/projects/${projectId}/chats/${chatId}/chat`,
}

export const ANNA_TARGET_MISSING = 'missing'
export const ANNA_TARGET_PROJECT_UNAVAILABLE = 'project_unavailable'

export const getAnnaTargetErrorMessage = reason =>
    reason === ANNA_TARGET_PROJECT_UNAVAILABLE
        ? translate('Anna activity project unavailable')
        : translate('Anna activity target missing')

const parse = path => {
    for (const route of ROUTES) {
        const match = typeof path === 'string' ? path.match(route.pattern) : null
        if (match) return { type: route.type, projectId: match[1], objectId: match[2] }
    }
    return null
}

// `undefined` means "could not tell" (offline, transient failure): never a reason to refuse.
const readExists = async docPath => {
    try {
        const snapshot = await getDb().doc(docPath).get()
        return snapshot.exists ? snapshot.data() || {} : null
    } catch (error) {
        // Missing objects answer `exists: false` for members (canProbeMissingObject); a denial is
        // an object this user may no longer read, which looks the same to them.
        if (error?.code === 'permission-denied' || error?.code === 'not-found') return null
        return undefined
    }
}

/**
 * Resolves the path an activity row should open.
 * @returns {Promise<{ path: string } | { error: string }>}
 */
export async function resolveAnnaActivityPath(path) {
    const target = parse(path)
    if (!target) return { path }
    const { loggedUserProjectsMap } = store.getState()
    const project = loggedUserProjectsMap?.[target.projectId]
    // Every detail route needs a project this session can select; otherwise it lands elsewhere.
    if (!project || !(project.index >= 0)) return { error: ANNA_TARGET_PROJECT_UNAVAILABLE }

    const data = await readExists(DOCS[target.type](target.projectId, target.objectId))
    if (data === null) return { error: ANNA_TARGET_MISSING }
    if (data === undefined || target.type !== 'chats') return { path }

    // A chat object of a task, note, goal or contact has that object's id. Open the object, and
    // check the object itself: a thread can outlive what it was about.
    const build = CHAT_TARGETS[data.type]
    if (!build) return { path: `/projects/${target.projectId}/user/${store.getState().loggedUser?.uid}/chats/followed` }
    if (data.type === 'topics') return { path }
    const object = await readExists(DOCS[data.type](target.projectId, target.objectId))
    if (object === null) return { error: ANNA_TARGET_MISSING }
    return { path: build(target.projectId, target.objectId) }
}
