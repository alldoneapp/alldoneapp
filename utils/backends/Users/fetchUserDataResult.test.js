/**
 * Regression tests for the production incident of 2026-08-13: a user document that provably
 * existed (uid lejVqrT6…, created 2020-08-27, readable with an admin token at the same moment)
 * was reported as missing by the client read, twice, once without any cache fallback reported.
 *
 * Believing that signal is destructive: AppContent.handleMissingUserDocument runs processNewUser,
 * whose uploadNewUser does `batch.set` on `users/{uid}` with a fresh-signup document. So an
 * apparent absence must be confirmed by an explicit server-only read before it may be reported
 * as `missing`.
 */
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        auth: () => ({ currentUser: { uid: 'user-1' } }),
        firestore: { FieldValue: { arrayRemove: jest.fn(), arrayUnion: jest.fn() } },
    },
}))

const mockGetDb = jest.fn()
const mockMapUserData = jest.fn((uid, data, isLoggedUser) => ({ uid, ...data, isLoggedUser }))
jest.mock('../firestore', () => ({
    getDb: (...args) => mockGetDb(...args),
    mapUserData: (...args) => mockMapUserData(...args),
    addFollower: jest.fn(),
    addFollowerWithoutFeeds: jest.fn(),
    addWorkflowStepFeedChain: jest.fn(),
    createDefaultProject: jest.fn(),
    forceUsersToReloadApp: jest.fn(),
    getAllUserProjects: jest.fn(),
    getId: jest.fn(),
    getObjectFollowersIds: jest.fn(),
    getProjectData: jest.fn(),
    getUserDataByUidOrEmail: jest.fn(),
    globalWatcherUnsub: {},
    inProductionEnvironment: jest.fn(),
}))

// Heavy transitive imports the module pulls in at load time but does not use in this path.
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: () => ({}), dispatch: jest.fn() } }))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../functions/BatchWrapper/batchWrapper', () => ({ BatchWrapper: class {} }))
jest.mock('../../BackendBridge', () => ({ __esModule: true, default: {} }))
jest.mock('../../InitialLoad/initialLoadHelper', () => ({
    getInitialProjectData: jest.fn(),
    watchProjectData: jest.fn(),
    watchProjectDataThatIsOnlyForProjectMembers: jest.fn(),
}))
jest.mock('../../defaultProjectAuthorization', () => ({}))
jest.mock('../../workflowOrder', () => ({ getWorkflowSortIndexUpdates: jest.fn() }))
jest.mock('../Assistants/assistantsFirestore', () => ({}))
jest.mock('../Chats/chatsFirestore', () => ({}))
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Projects/guidesFirestore', () => ({}))
jest.mock('../Workstreams/workstreamsFirestore', () => ({}))
jest.mock('../Contacts/contactsFirestore', () => ({}))
jest.mock('./userUpdates', () => ({}))
jest.mock('../../../components/AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: jest.fn(),
}))
jest.mock('../../../components/Followers/FollowerConstants', () => ({}))
jest.mock('../../../components/Guides/guidesHelper', () => ({}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../components/SettingsView/SettingsHelper', () => ({}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({ __esModule: true, default: {} }))
jest.mock('../../../components/Workstreams/WorkstreamHelper', () => ({ DEFAULT_WORKSTREAM_ID: 'ws' }))

const { fetchUserDataResult } = require('./usersFirestore')

const snapshot = ({ exists, data = null, fromCache = false, withMetadata = true }) => ({
    exists,
    data: () => data,
    ...(withMetadata ? { metadata: { fromCache } } : {}),
})

// First read is the plain get(); the confirming read is get({ source: 'server' }).
const buildDb = ({ first, server }) => {
    const get = jest.fn(options => {
        if (options === undefined) return Promise.resolve(first)
        expect(options).toEqual({ source: 'server' })
        return typeof server === 'function' ? server() : Promise.resolve(server)
    })
    const doc = jest.fn(() => ({ get }))
    return { doc, get }
}

describe('fetchUserDataResult', () => {
    let consoleWarn
    let consoleError

    beforeEach(() => {
        mockGetDb.mockReset()
        mockMapUserData.mockClear()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
        consoleError.mockRestore()
    })

    it('returns the mapped user without a second read when the document exists', async () => {
        const db = buildDb({ first: snapshot({ exists: true, data: { email: 'a@b.c' } }) })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(result.error).toBe(null)
        expect(result.user).toEqual({ uid: 'user-1', email: 'a@b.c', isLoggedUser: true })
        expect(db.get).toHaveBeenCalledTimes(1)
    })

    // The incident itself: the first read says missing, the server has the document.
    it('recovers the document when a server read finds what the first read missed', async () => {
        const db = buildDb({
            first: snapshot({ exists: false }),
            server: snapshot({ exists: true, data: { email: 'karsten@example.com' } }),
        })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(result.error).toBe(null)
        expect(result.user).toEqual({ uid: 'user-1', email: 'karsten@example.com', isLoggedUser: true })
        expect(db.get).toHaveBeenCalledTimes(2)
        // Never reported as missing, so the caller cannot reach the account-recovery path.
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('reports missing only when an explicit server read confirms the absence', async () => {
        const db = buildDb({ first: snapshot({ exists: false }), server: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({ user: null, missing: true, error: null })
        expect(db.get).toHaveBeenCalledTimes(2)
        expect(consoleError).toHaveBeenCalled()
    })

    it('reports a failed read, not a missing account, when the confirming read cannot reach the server', async () => {
        const offline = new Error('Failed to get document because the client is offline.')
        const db = buildDb({ first: snapshot({ exists: false }), server: () => Promise.reject(offline) })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        // missing:false is what keeps the caller retrying instead of overwriting users/{uid}.
        expect(result).toEqual({ user: null, missing: false, error: offline })
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('confirms before reporting missing even when the first read claims no cache fallback', async () => {
        // The production case: fromCache was false and the document existed anyway.
        const db = buildDb({
            first: snapshot({ exists: false, fromCache: false }),
            server: snapshot({ exists: true, data: { email: 'a@b.c' } }),
        })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(result.user).not.toBe(null)
    })

    it('does not treat a metadata-less snapshot as server-confirmed', async () => {
        const db = buildDb({
            first: snapshot({ exists: false, withMetadata: false }),
            server: snapshot({ exists: true, data: { email: 'a@b.c' } }),
        })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(consoleWarn.mock.calls.flat().join(' ')).toContain('carried no metadata')
    })

    it('still reports a failed first read as an error rather than a missing account', async () => {
        const denied = new Error('permission-denied')
        mockGetDb.mockReturnValue({
            doc: () => ({
                get: () => Promise.reject(denied),
            }),
        })

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({ user: null, missing: false, error: denied })
    })
})
