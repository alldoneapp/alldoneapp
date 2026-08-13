import store from '../../redux/store'
import { getDb } from '../backends/firestore'
import { recoverDroppedProject } from './projectRecovery'
import { loadGlobalData } from './initialLoadHelper'
import {
    resetBootIntegrityHealerForTests,
    runBootIntegrityCheck,
    scheduleBootIntegrityChecks,
} from './bootIntegrityHealer'

jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
}))

jest.mock('../backends/firestore', () => ({
    getDb: jest.fn(),
}))

jest.mock('./projectRecovery', () => ({
    recoverDroppedProject: jest.fn(),
}))

jest.mock('./initialLoadHelper', () => ({
    loadGlobalData: jest.fn(),
}))

// Mutable state the mocked store serves; repairs mutate it like the real dispatches would.
let state

const buildDbMock = ({ roleUserId = 'admin-1' } = {}) => ({
    doc: jest.fn(path => {
        expect(path).toBe('roles/administrator')
        return { get: jest.fn(() => Promise.resolve({ data: () => ({ userId: roleUserId }) })) }
    }),
    disableNetwork: jest.fn(() => Promise.resolve()),
    enableNetwork: jest.fn(() => Promise.resolve()),
})

describe('runBootIntegrityCheck', () => {
    let consoleWarn

    beforeEach(() => {
        resetBootIntegrityHealerForTests()
        state = {
            loggedUser: { uid: 'user1', projectIds: ['p1', 'p2'] },
            loggedUserProjectsMap: { p1: { id: 'p1' }, p2: { id: 'p2' } },
            administratorUser: { uid: 'admin-1' },
        }
        store.getState.mockImplementation(() => state)
        getDb.mockReturnValue(buildDbMock())
        recoverDroppedProject.mockReset()
        recoverDroppedProject.mockImplementation(async projectId => {
            state.loggedUserProjectsMap[projectId] = { id: projectId }
            return true
        })
        loadGlobalData.mockReset()
        loadGlobalData.mockImplementation(async () => {
            state.administratorUser = { uid: 'admin-1' }
        })
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('does nothing when redux holds everything the user is entitled to', async () => {
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
        expect(loadGlobalData).not.toHaveBeenCalled()
        expect(getDb().disableNetwork).not.toHaveBeenCalled()
    })

    it('does nothing for anonymous or logged-out sessions', async () => {
        state.loggedUser = { uid: 'anon', isAnonymous: true, projectIds: ['p1'] }
        state.loggedUserProjectsMap = {}
        await runBootIntegrityCheck({ settleMs: 0 })

        state.loggedUser = undefined
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
    })

    it('recovers a dropped project by plain re-fetch, without touching the network', async () => {
        delete state.loggedUserProjectsMap.p2

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).toHaveBeenCalledWith('p2')
        expect(recoverDroppedProject).toHaveBeenCalledTimes(1)
        const db = getDb()
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('reloads global data when the administrator user is empty but the role names one', async () => {
        state.administratorUser = {}

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(loadGlobalData).toHaveBeenCalledTimes(1)
    })

    it('does not treat a missing administrator as an anomaly when no role is configured', async () => {
        state.administratorUser = {}
        getDb.mockReturnValue(buildDbMock({ roleUserId: null }))

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(loadGlobalData).not.toHaveBeenCalled()
    })

    it('cycles the Firestore network and retries when plain re-fetches do not help', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        delete state.loggedUserProjectsMap.p2
        // First repair round fails (transport still wedged), second succeeds.
        recoverDroppedProject
            .mockImplementationOnce(async () => false)
            .mockImplementationOnce(async projectId => {
                state.loggedUserProjectsMap[projectId] = { id: projectId }
                return true
            })

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(recoverDroppedProject).toHaveBeenCalledTimes(2)
    })

    it('bounds network cycles per session', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        delete state.loggedUserProjectsMap.p2
        // Recovery never succeeds: every check escalates to a network cycle.
        recoverDroppedProject.mockImplementation(async () => false)

        await runBootIntegrityCheck({ settleMs: 0 })
        await runBootIntegrityCheck({ settleMs: 0 })
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(db.disableNetwork).toHaveBeenCalledTimes(2)
    })
})

describe('scheduleBootIntegrityChecks', () => {
    beforeEach(() => {
        resetBootIntegrityHealerForTests()
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('schedules its checks only once per session', () => {
        scheduleBootIntegrityChecks()
        const timersAfterFirst = jest.getTimerCount()
        expect(timersAfterFirst).toBeGreaterThan(0)

        scheduleBootIntegrityChecks()
        expect(jest.getTimerCount()).toBe(timersAfterFirst)
    })
})
