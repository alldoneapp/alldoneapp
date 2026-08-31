/**
 * Regression tests for the production incident of 2026-08-13: a user document that provably
 * existed (uid lejVqrT6…, created 2020-08-27, readable with an admin token at the same moment)
 * was reported as missing by the client read, twice, once without any cache fallback reported.
 *
 * Believing that signal is destructive: AppContent.handleMissingUserDocument runs processNewUser,
 * whose uploadNewUser does `batch.set` on `users/{uid}` with a fresh-signup document. So an
 * apparent absence must be confirmed by an independent Firestore Lite direct read before it may
 * be reported as `missing`.
 */
const mockGetIdToken = jest.fn(() => Promise.resolve('token'))
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        auth: () => ({ currentUser: { uid: 'user-1', getIdToken: (...args) => mockGetIdToken(...args) } }),
        firestore: { FieldValue: { arrayRemove: jest.fn(), arrayUnion: jest.fn() } },
    },
}))

const mockGetDb = jest.fn()
const mockGlobalWatcherUnsub = {}
const mockRestartFirestoreNetwork = jest.fn(() => Promise.resolve())
const mockMapUserData = jest.fn((uid, data, isLoggedUser) => ({ uid, ...data, isLoggedUser }))
jest.mock('../firestore', () => ({
    getDb: (...args) => mockGetDb(...args),
    mapUserData: (...args) => mockMapUserData(...args),
    restartFirestoreNetwork: (...args) => mockRestartFirestoreNetwork(...args),
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
    globalWatcherUnsub: mockGlobalWatcherUnsub,
    inProductionEnvironment: jest.fn(),
}))

const mockReadDocumentDirectlyFromServer = jest.fn()
jest.mock('../firestoreDirectRead', () => ({
    readDocumentDirectlyFromServer: (...args) => mockReadDocumentDirectlyFromServer(...args),
}))

// Heavy transitive imports the module pulls in at load time but does not use in this path.
const mockStoreGetState = jest.fn(() => ({}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: (...args) => mockStoreGetState(...args), dispatch: jest.fn() },
}))
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

const { fetchUserDataResult, updateUserDataDirectly, watchProjectUsers } = require('./usersFirestore')

const snapshot = ({ exists, data = null, fromCache = false, withMetadata = true }) => ({
    exists,
    data: () => data,
    ...(withMetadata ? { metadata: { fromCache } } : {}),
})

const buildDb = ({ first }) => {
    const get = jest.fn(() => Promise.resolve(first))
    const doc = jest.fn(() => ({ get }))
    return { doc, get }
}

describe('fetchUserDataResult', () => {
    let consoleWarn
    let consoleError

    beforeEach(() => {
        mockStoreGetState.mockReset()
        mockStoreGetState.mockReturnValue({})
        mockGetDb.mockReset()
        mockMapUserData.mockClear()
        mockRestartFirestoreNetwork.mockClear()
        mockGetIdToken.mockClear()
        mockGetIdToken.mockResolvedValue('token')
        mockReadDocumentDirectlyFromServer.mockReset()
        Object.keys(mockGlobalWatcherUnsub).forEach(key => delete mockGlobalWatcherUnsub[key])
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('does not read Redux state for a personal update without a project mutation', async () => {
        const update = jest.fn(() => Promise.resolve())
        mockGetDb.mockReturnValue({ doc: jest.fn(() => ({ update })) })

        await updateUserDataDirectly('user-1', { activeTaskId: 'task-1' })

        expect(mockStoreGetState).not.toHaveBeenCalled()
        expect(update).toHaveBeenCalledWith({ activeTaskId: 'task-1' })
    })

    it('watches the authoritative project member ids without an unsafe users collection query', async () => {
        const listeners = {}
        const unsubscribers = {}
        const doc = jest.fn(path => ({
            onSnapshot: (next, error) => {
                listeners[path] = { next, error }
                unsubscribers[path] = jest.fn()
                return unsubscribers[path]
            },
        }))
        mockGetDb.mockReturnValue({ doc })
        const callback = jest.fn()

        await watchProjectUsers('project-1', callback, 'project-1Users')
        listeners['projects/project-1'].next({ exists: true, data: () => ({ userIds: ['user-1', 'user-2'] }) })
        listeners['users/user-1'].next(snapshot({ exists: true, data: { displayName: 'One' } }))
        expect(callback).not.toHaveBeenCalled()

        listeners['users/user-2'].next(snapshot({ exists: true, data: { displayName: 'Two' } }))
        expect(callback).toHaveBeenLastCalledWith([
            { uid: 'user-1', displayName: 'One', isLoggedUser: false },
            { uid: 'user-2', displayName: 'Two', isLoggedUser: false },
        ])

        listeners['users/user-1'].next(snapshot({ exists: true, data: { displayName: 'One updated' } }))
        expect(callback).toHaveBeenLastCalledWith([
            { uid: 'user-1', displayName: 'One updated', isLoggedUser: false },
            { uid: 'user-2', displayName: 'Two', isLoggedUser: false },
        ])

        listeners['projects/project-1'].next({ exists: true, data: () => ({ userIds: ['user-1', 'user-3'] }) })
        expect(unsubscribers['users/user-2']).toHaveBeenCalledTimes(1)
        listeners['users/user-3'].next(snapshot({ exists: true, data: { displayName: 'Three' } }))
        expect(callback).toHaveBeenLastCalledWith([
            { uid: 'user-1', displayName: 'One updated', isLoggedUser: false },
            { uid: 'user-3', displayName: 'Three', isLoggedUser: false },
        ])

        mockGlobalWatcherUnsub['project-1Users']()
        expect(unsubscribers['projects/project-1']).toHaveBeenCalledTimes(1)
        expect(unsubscribers['users/user-1']).toHaveBeenCalledTimes(1)
        expect(unsubscribers['users/user-3']).toHaveBeenCalledTimes(1)
        expect(doc).not.toHaveBeenCalledWith('users')
    })

    it('omits a stale unreadable member without stalling the project user list', async () => {
        const listeners = {}
        const doc = jest.fn(path => ({
            onSnapshot: (next, error) => {
                listeners[path] = { next, error }
                return jest.fn()
            },
        }))
        mockGetDb.mockReturnValue({ doc })
        const callback = jest.fn()

        await watchProjectUsers('project-1', callback, 'project-1Users')
        listeners['projects/project-1'].next({
            exists: true,
            data: () => ({ userIds: ['user-1', 'stale-user'] }),
        })
        listeners['users/user-1'].next(snapshot({ exists: true, data: { displayName: 'One' } }))
        expect(callback).not.toHaveBeenCalled()

        listeners['users/stale-user'].error({ code: 'permission-denied' })

        expect(callback).toHaveBeenLastCalledWith([{ uid: 'user-1', displayName: 'One', isLoggedUser: false }])
        expect(consoleWarn).not.toHaveBeenCalled()
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('starts member listeners from the project already loaded in redux', async () => {
        const listeners = {}
        const doc = jest.fn(path => ({
            onSnapshot: (next, error) => {
                listeners[path] = { next, error }
                return jest.fn()
            },
        }))
        mockGetDb.mockReturnValue({ doc })
        mockStoreGetState.mockReturnValue({
            loggedUserProjectsMap: { 'project-1': { userIds: ['user-1'] } },
        })
        const callback = jest.fn()

        await watchProjectUsers('project-1', callback, 'project-1Users')

        expect(listeners['users/user-1']).toBeDefined()
        listeners['users/user-1'].next(snapshot({ exists: true, data: { displayName: 'One' } }))
        expect(callback).toHaveBeenLastCalledWith([{ uid: 'user-1', displayName: 'One', isLoggedUser: false }])
    })

    it('reports an authoritative project-listener failure to the loader', async () => {
        const listeners = {}
        mockGetDb.mockReturnValue({
            doc: jest.fn(path => ({
                onSnapshot: (next, error) => {
                    listeners[path] = { next, error }
                    return jest.fn()
                },
            })),
        })
        const onError = jest.fn()

        await watchProjectUsers('project-1', jest.fn(), 'project-1Users', { onError })
        const error = { code: 'permission-denied' }
        listeners['projects/project-1'].error(error)

        expect(onError).toHaveBeenCalledWith(error)
        expect(consoleError).not.toHaveBeenCalled()
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

    // The incident itself: the realtime client says missing, the independent server read has it.
    it('recovers the document when a direct server read finds what the realtime client missed', async () => {
        const db = buildDb({
            first: snapshot({ exists: false }),
        })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({
            exists: true,
            data: { email: 'karsten@example.com' },
        })

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(result.error).toBe(null)
        expect(result.user).toEqual({ uid: 'user-1', email: 'karsten@example.com', isLoggedUser: true })
        expect(db.get).toHaveBeenCalledTimes(1)
        expect(mockReadDocumentDirectlyFromServer).toHaveBeenCalledWith('users/user-1')
        expect(mockRestartFirestoreNetwork).toHaveBeenCalledTimes(1)
        // Never reported as missing, so the caller cannot reach the account-recovery path.
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('reports missing only when the independent direct read confirms the absence', async () => {
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: false, data: undefined })

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({ user: null, missing: true, error: null, verified: true })
        expect(db.get).toHaveBeenCalledTimes(1)
        expect(consoleError).toHaveBeenCalled()
    })

    it('reports a failed read, not a missing account, when the direct read cannot reach the server', async () => {
        const offline = new Error('Failed to get document because the client is offline.')
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockRejectedValue(offline)

        const result = await fetchUserDataResult('user-1', true)

        // missing:false is what keeps the caller retrying instead of overwriting users/{uid}.
        expect(result).toEqual({ user: null, missing: false, error: offline, verified: false })
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('checks the independent client even when the first read claims no cache fallback', async () => {
        // The production case: fromCache was false and the document existed anyway.
        const db = buildDb({
            first: snapshot({ exists: false, fromCache: false }),
        })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: { email: 'a@b.c' } })

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(result.user).not.toBe(null)
    })

    it('does not treat a metadata-less snapshot as server-confirmed', async () => {
        const db = buildDb({
            first: snapshot({ exists: false, withMetadata: false }),
        })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: { email: 'a@b.c' } })

        const result = await fetchUserDataResult('user-1', true)

        expect(result.missing).toBe(false)
        expect(consoleWarn.mock.calls.flat().join(' ')).toContain('carried no metadata')
    })

    it('still uses a recovered direct result when restarting the realtime connection fails', async () => {
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: { email: 'a@b.c' } })
        mockRestartFirestoreNetwork.mockRejectedValueOnce(new Error('restart failed'))

        const result = await fetchUserDataResult('user-1', true)

        expect(result.user).toEqual({ uid: 'user-1', email: 'a@b.c', isLoggedUser: true })
        expect(result.missing).toBe(false)
    })

    it('still reports a non-permission read failure as an error rather than a missing account', async () => {
        const unavailable = Object.assign(new Error('network unavailable'), { code: 'unavailable' })
        mockGetDb.mockReturnValue({
            doc: () => ({
                get: () => Promise.reject(unavailable),
            }),
        })

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({ user: null, missing: false, error: unavailable, verified: false })
    })

    it('refreshes the own-user token once when the first Firestore read is denied', async () => {
        const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })
        const get = jest
            .fn()
            .mockRejectedValueOnce(denied)
            .mockResolvedValueOnce(snapshot({ exists: true, data: { email: 'a@b.c' } }))
        mockGetDb.mockReturnValue({ doc: () => ({ get }) })

        const result = await fetchUserDataResult('user-1', true)

        expect(result.user).toEqual({ uid: 'user-1', email: 'a@b.c', isLoggedUser: true })
        expect(mockGetIdToken).toHaveBeenNthCalledWith(1)
        expect(mockGetIdToken).toHaveBeenNthCalledWith(2, true)
        expect(get).toHaveBeenCalledTimes(2)
    })

    it('uses the authenticated direct read when Firestore still denies the own user after token refresh', async () => {
        const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })
        const get = jest.fn().mockRejectedValue(denied)
        mockGetDb.mockReturnValue({ doc: () => ({ get }) })
        mockReadDocumentDirectlyFromServer.mockResolvedValue({
            exists: true,
            data: { email: 'a@b.c', defaultProjectId: 'project-1' },
        })

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({
            user: { uid: 'user-1', email: 'a@b.c', defaultProjectId: 'project-1', isLoggedUser: true },
            missing: false,
            error: null,
            verified: true,
        })
        expect(get).toHaveBeenCalledTimes(2)
        expect(mockGetIdToken).toHaveBeenNthCalledWith(2, true)
        expect(mockReadDocumentDirectlyFromServer).toHaveBeenCalledWith('users/user-1')
        expect(mockRestartFirestoreNetwork).toHaveBeenCalledWith('adopt the authenticated user during login')
    })

    it('recognizes a genuinely new user when the direct read confirms no user document', async () => {
        const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })
        const get = jest.fn().mockRejectedValue(denied)
        mockGetDb.mockReturnValue({ doc: () => ({ get }) })
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: false, data: undefined })

        const result = await fetchUserDataResult('user-1', true)

        expect(result).toEqual({ user: null, missing: true, error: null, verified: true })
        expect(mockReadDocumentDirectlyFromServer).toHaveBeenCalledTimes(1)
        expect(mockRestartFirestoreNetwork).toHaveBeenCalledTimes(1)
        expect(consoleError).not.toHaveBeenCalled()
    })
})

/**
 * AT-2428. Resolving an id that may equally be a contact, an assistant or a workstream is a PROBE,
 * and for a probe "not a user" is an ordinary answer. Production paid a REST round trip and logged
 * `User document not found in Firestore: /users/...` as a console ERROR for every one of them,
 * which is what made an ordinary contact navigation look like a broken account.
 *
 * The safety net must not be weakened by that: a probe may only answer cheaply, and a caller with
 * nothing to explain the absence escalates to the verified read, which is still the only thing
 * allowed to say `verified: true`.
 */
describe('fetchUserDataResult probes (absenceIsExpected)', () => {
    let consoleWarn
    let consoleError

    beforeEach(() => {
        mockGetDb.mockReset()
        mockMapUserData.mockClear()
        mockRestartFirestoreNetwork.mockClear()
        mockReadDocumentDirectlyFromServer.mockReset()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
        consoleError.mockRestore()
    })

    it('answers a missing document without the verification round trip or an error log', async () => {
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('contact-1', false, { absenceIsExpected: true })

        expect(result).toEqual({ user: null, missing: true, error: null, verified: false })
        expect(mockReadDocumentDirectlyFromServer).not.toHaveBeenCalled()
        expect(mockRestartFirestoreNetwork).not.toHaveBeenCalled()
        expect(consoleError).not.toHaveBeenCalled()
        expect(consoleWarn).not.toHaveBeenCalled()
    })

    it('marks the cheap answer unverified so an escalating caller can tell the two apart', async () => {
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)
        const probe = await fetchUserDataResult('contact-1', false, { absenceIsExpected: true })

        mockGetDb.mockReturnValue(buildDb({ first: snapshot({ exists: false }) }))
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: false, data: undefined })
        const escalated = await fetchUserDataResult('contact-1', false)

        expect(probe.verified).toBe(false)
        expect(escalated.verified).toBe(true)
        expect(escalated.missing).toBe(true)
    })

    it('still returns an existing user normally', async () => {
        const db = buildDb({ first: snapshot({ exists: true, data: { email: 'a@b.c' } }) })
        mockGetDb.mockReturnValue(db)

        const result = await fetchUserDataResult('user-1', false, { absenceIsExpected: true })

        expect(result.user).toEqual({ uid: 'user-1', email: 'a@b.c', isLoggedUser: false })
        expect(result.missing).toBe(false)
        expect(result.verified).toBe(true)
    })

    it('still reports a failed read as an error rather than a missing user', async () => {
        const denied = new Error('permission-denied')
        mockGetDb.mockReturnValue({ doc: () => ({ get: () => Promise.reject(denied) }) })

        const result = await fetchUserDataResult('contact-1', false, { absenceIsExpected: true })

        // A probe is allowed to skip the CONFIRMATION of an absence, never to turn a broken read
        // into one: `missing` stays false so the caller does not conclude "no such user".
        expect(result).toEqual({ user: null, missing: false, error: denied, verified: false })
    })

    it('leaves the logged-user path fully verified and loud', async () => {
        const db = buildDb({ first: snapshot({ exists: false }) })
        mockGetDb.mockReturnValue(db)
        mockReadDocumentDirectlyFromServer.mockResolvedValue({ exists: false, data: undefined })

        const result = await fetchUserDataResult('user-1', true)

        expect(mockReadDocumentDirectlyFromServer).toHaveBeenCalledWith('users/user-1')
        expect(consoleError).toHaveBeenCalled()
        expect(result.missing).toBe(true)
        expect(result.verified).toBe(true)
    })
})
