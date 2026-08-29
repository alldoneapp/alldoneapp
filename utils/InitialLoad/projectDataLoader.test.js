import store from '../../redux/store'
import { watchProjectContacts } from '../backends/Contacts/contactsFirestore'
import { watchProjectUsers } from '../backends/Users/usersFirestore'
import { watchProjectWorkstreams } from '../backends/Workstreams/workstreamsFirestore'
import { watchAssistants } from '../backends/Assistants/assistantsFirestore'
import {
    ALL_PROJECT_DATA_KINDS,
    areProjectContactsLoaded,
    ensureProjectDataLoaded,
    ensureProjectsDataLoaded,
    FIRST_SNAPSHOT_TIMEOUT_MS,
    forgetProjectData,
    isProjectDataLoaded,
    isProjectDataRequested,
    PROJECT_DATA_ASSISTANTS,
    PROJECT_DATA_CONTACTS,
    PROJECT_DATA_USERS,
    PROJECT_DATA_WORKSTREAMS,
    requestProjectDataOnLookupMiss,
    resetProjectDataLoaderForTests,
    warmProjectsData,
} from './projectDataLoader'

jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
    dispatch: jest.fn(),
}))

jest.mock('../../redux/actions', () => ({
    setUsersInProject: jest.fn((projectId, users) => ({ type: 'Set users in project', projectId, users })),
    setContactsInProject: jest.fn((projectId, contacts) => ({ type: 'Set contacts in project', projectId, contacts })),
    setWorkstreamsInProject: jest.fn((projectId, workstreams) => ({
        type: 'Set workstreams in project',
        projectId,
        workstreams,
    })),
    setAssistantsInProject: jest.fn((projectId, assistants) => ({
        type: 'Set assistants in project',
        projectId,
        assistants,
    })),
}))

jest.mock('../backends/Contacts/contactsFirestore', () => ({ watchProjectContacts: jest.fn() }))
jest.mock('../backends/Users/usersFirestore', () => ({ watchProjectUsers: jest.fn() }))
jest.mock('../backends/Workstreams/workstreamsFirestore', () => ({ watchProjectWorkstreams: jest.fn() }))
jest.mock('../backends/Assistants/assistantsFirestore', () => ({ watchAssistants: jest.fn() }))

// The watchers all take a callback; capture it so a test can deliver a "snapshot" on demand.
const deliver = (watcherMock, data, callIndex = 0) => {
    const call = watcherMock.mock.calls[callIndex]
    // `watchAssistants` is (projectId, watcherKey, callback); the other three are
    // (projectId, callback, watcherKey). That asymmetry is exactly what the descriptor table
    // in the loader exists to absorb, so it is worth exercising through the real signature.
    const callback = watcherMock === watchAssistants ? call[2] : call[1]
    callback(data)
}

const setProjects = (...projectIds) =>
    store.getState.mockReturnValue({
        loggedUserProjectsMap: projectIds.reduce((map, id) => ({ ...map, [id]: { id } }), {}),
    })

describe('projectDataLoader', () => {
    let consoleWarn

    beforeEach(() => {
        jest.useFakeTimers()
        resetProjectDataLoaderForTests()
        store.getState.mockReset()
        store.dispatch.mockReset()
        ;[watchProjectContacts, watchProjectUsers, watchProjectWorkstreams, watchAssistants].forEach(mock =>
            mock.mockReset()
        )
        setProjects('p1', 'p2')
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
        jest.useRealTimers()
    })

    it('arms one watcher per collection and fills redux from the first snapshot', async () => {
        const loaded = ensureProjectDataLoaded('p1')

        expect(watchProjectUsers).toHaveBeenCalledTimes(1)
        expect(watchProjectContacts).toHaveBeenCalledTimes(1)
        expect(watchProjectWorkstreams).toHaveBeenCalledTimes(1)
        expect(watchAssistants).toHaveBeenCalledTimes(1)

        // The watcher keys have to keep matching `unwatchProjectData`, which unwatches by name.
        expect(watchProjectContacts.mock.calls[0][2]).toBe('p1Contacts')
        expect(watchProjectUsers.mock.calls[0][2]).toBe('p1Users')
        expect(watchProjectWorkstreams.mock.calls[0][2]).toBe('p1Workstreams')
        expect(watchAssistants.mock.calls[0][1]).toBe('p1Assistants')

        deliver(watchProjectUsers, [{ uid: 'u1' }])
        deliver(watchProjectContacts, [{ uid: 'c1' }])
        deliver(watchProjectWorkstreams, [{ uid: 'w1' }])
        deliver(watchAssistants, [{ uid: 'a1' }])

        await expect(loaded).resolves.toBe(true)
        expect(store.dispatch).toHaveBeenCalledWith({
            type: 'Set contacts in project',
            projectId: 'p1',
            contacts: [{ uid: 'c1' }],
        })
        expect(areProjectContactsLoaded('p1')).toBe(true)
    })

    it('forwards primary connection tracking to the contacts watcher', async () => {
        const loaded = ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS, { trackConnectionHealth: true })

        expect(watchProjectContacts.mock.calls[0][3]).toEqual(
            expect.objectContaining({ trackConnectionHealth: true, onError: expect.any(Function) })
        )
        deliver(watchProjectContacts, [])
        await expect(loaded).resolves.toBe(true)
    })

    it('forwards loader failures to the users watcher too', () => {
        ensureProjectDataLoaded('p1', PROJECT_DATA_USERS)

        expect(watchProjectUsers.mock.calls[0][3]).toEqual(expect.objectContaining({ onError: expect.any(Function) }))
    })

    it('forwards loader failures to workstream and assistant watchers', () => {
        ensureProjectDataLoaded('p1', [PROJECT_DATA_WORKSTREAMS, PROJECT_DATA_ASSISTANTS])

        expect(watchProjectWorkstreams.mock.calls[0][3]).toEqual(
            expect.objectContaining({ onError: expect.any(Function) })
        )
        expect(watchAssistants.mock.calls[0][3]).toEqual(expect.objectContaining({ onError: expect.any(Function) }))
    })

    it('is idempotent - a second request never arms a second watcher', () => {
        ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)
        ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)
        ensureProjectDataLoaded('p1')

        expect(watchProjectContacts).toHaveBeenCalledTimes(1)
    })

    it('records the request BEFORE arming, so a burst of lookup misses cannot double-arm', () => {
        // This is the render hot path: many rows of the same unloaded project miss in one frame.
        for (let i = 0; i < 25; i++) requestProjectDataOnLookupMiss('p1', PROJECT_DATA_CONTACTS)

        expect(watchProjectContacts).toHaveBeenCalledTimes(1)
    })

    it('does not report loaded until a snapshot actually arrives', () => {
        ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)

        expect(isProjectDataRequested('p1', PROJECT_DATA_CONTACTS)).toBe(true)
        expect(isProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)).toBe(false)

        deliver(watchProjectContacts, [])

        expect(isProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)).toBe(true)
    })

    it('stops blocking after the first-snapshot budget, but leaves the watcher armed', async () => {
        // A wedged stream must delay login by at most one budget - never hang it - and must still
        // fill redux if it recovers later.
        const loaded = ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)

        jest.advanceTimersByTime(FIRST_SNAPSHOT_TIMEOUT_MS)
        await expect(loaded).resolves.toBe(false)

        deliver(watchProjectContacts, [{ uid: 'late' }])
        expect(store.dispatch).toHaveBeenCalledWith({
            type: 'Set contacts in project',
            projectId: 'p1',
            contacts: [{ uid: 'late' }],
        })
    })

    it('keeps routine production timeouts in telemetry instead of the console', async () => {
        const previousNodeEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
            const loaded = ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)

            jest.advanceTimersByTime(FIRST_SNAPSHOT_TIMEOUT_MS)
            await expect(loaded).resolves.toBe(false)
            expect(consoleWarn).not.toHaveBeenCalled()
        } finally {
            process.env.NODE_ENV = previousNodeEnv
        }
    })

    it('forgets a project whose watcher throws, so a later render retries it', async () => {
        watchProjectContacts.mockImplementationOnce(() => {
            throw new Error('offline')
        })

        await expect(ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)).resolves.toBe(false)
        expect(isProjectDataRequested('p1', PROJECT_DATA_CONTACTS)).toBe(false)

        ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)
        expect(watchProjectContacts).toHaveBeenCalledTimes(2)
    })

    it('forgets a project whose watcher rejects asynchronously', async () => {
        watchProjectContacts.mockImplementationOnce(() => Promise.reject(new Error('permission-denied')))

        await expect(ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)).resolves.toBe(false)
        expect(isProjectDataRequested('p1', PROJECT_DATA_CONTACTS)).toBe(false)
    })

    it('never writes an empty users snapshot over a good one', () => {
        // Preserved from the original `updateUsers`: a project always has at least its owner, so
        // an empty snapshot means a degraded read, and applying it would strip every avatar.
        ensureProjectDataLoaded('p1', PROJECT_DATA_USERS)
        deliver(watchProjectUsers, [])

        expect(store.dispatch).not.toHaveBeenCalled()

        deliver(watchProjectUsers, [{ uid: 'u1' }])
        expect(store.dispatch).toHaveBeenCalledWith({
            type: 'Set users in project',
            projectId: 'p1',
            users: [{ uid: 'u1' }],
        })
    })

    it('writes an empty snapshot for the other collections - a project can genuinely have none', () => {
        ensureProjectDataLoaded('p1', PROJECT_DATA_CONTACTS)
        deliver(watchProjectContacts, [])

        expect(store.dispatch).toHaveBeenCalledWith({
            type: 'Set contacts in project',
            projectId: 'p1',
            contacts: [],
        })
    })

    describe('requestProjectDataOnLookupMiss', () => {
        it('ignores projects redux does not know about', () => {
            // An id from an old mention, a copied task or a deleted project must never be able to
            // arm an unbounded number of watchers from a render path.
            expect(requestProjectDataOnLookupMiss('p-unknown', PROJECT_DATA_CONTACTS)).toBe(false)
            expect(watchProjectContacts).not.toHaveBeenCalled()
        })

        it('loads a known project on a miss', () => {
            expect(requestProjectDataOnLookupMiss('p2', PROJECT_DATA_CONTACTS)).toBe(true)
            expect(watchProjectContacts).toHaveBeenCalledTimes(1)
            expect(watchProjectContacts.mock.calls[0][0]).toBe('p2')
        })

        it('reports nothing to do once the project is already requested', () => {
            requestProjectDataOnLookupMiss('p2', PROJECT_DATA_CONTACTS)
            expect(requestProjectDataOnLookupMiss('p2', PROJECT_DATA_CONTACTS)).toBe(false)
        })

        it('does not read the store at all on the fast path', () => {
            requestProjectDataOnLookupMiss('p2', PROJECT_DATA_CONTACTS)
            store.getState.mockClear()

            requestProjectDataOnLookupMiss('p2', PROJECT_DATA_CONTACTS)

            expect(store.getState).not.toHaveBeenCalled()
        })

        it('defaults to every collection when no kind is given', () => {
            requestProjectDataOnLookupMiss('p2')

            ALL_PROJECT_DATA_KINDS.forEach(kind => expect(isProjectDataRequested('p2', kind)).toBe(true))
        })
    })

    describe('warmProjectsData', () => {
        it('staggers the sweep rather than firing everything at once', () => {
            setProjects('p1', 'p2', 'p3')
            warmProjectsData(['p1', 'p2', 'p3'], { staggerMs: 50, kinds: PROJECT_DATA_CONTACTS })

            expect(watchProjectContacts).not.toHaveBeenCalled()

            jest.advanceTimersByTime(0)
            expect(watchProjectContacts).toHaveBeenCalledTimes(1)

            jest.advanceTimersByTime(100)
            expect(watchProjectContacts).toHaveBeenCalledTimes(3)
        })

        it('can be cancelled before it finishes', () => {
            const cancel = warmProjectsData(['p1', 'p2'], { staggerMs: 50, kinds: PROJECT_DATA_CONTACTS })

            cancel()
            jest.advanceTimersByTime(1000)

            expect(watchProjectContacts).not.toHaveBeenCalled()
        })
    })

    it('forgets a project so a re-added one loads again', () => {
        ensureProjectDataLoaded('p1')
        ALL_PROJECT_DATA_KINDS.forEach(kind => expect(isProjectDataRequested('p1', kind)).toBe(true))

        expect(forgetProjectData('p1')).toBe(true)
        ALL_PROJECT_DATA_KINDS.forEach(kind => expect(isProjectDataRequested('p1', kind)).toBe(false))

        ensureProjectDataLoaded('p1', PROJECT_DATA_ASSISTANTS)
        expect(watchAssistants).toHaveBeenCalledTimes(2)
    })

    it('ignores a missing project id instead of throwing', async () => {
        await expect(ensureProjectDataLoaded(undefined)).resolves.toBe(false)
        await expect(ensureProjectsDataLoaded(null)).resolves.toBe(true)
        expect(watchProjectWorkstreams).not.toHaveBeenCalled()
    })
})
