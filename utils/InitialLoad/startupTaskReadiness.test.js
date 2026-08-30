let mockState
let mockListeners

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockState,
        subscribe: callback => {
            mockListeners.push(callback)
            return () => {
                mockListeners = mockListeners.filter(listener => listener !== callback)
            }
        },
    },
}))

const {
    DEFERRED_STARTUP_WORK_FALLBACK_MS,
    TASK_DATA_SETTLE_GRACE_MS,
    scheduleAfterInitialTaskData,
} = require('./startupTaskReadiness')

const buildState = () => ({
    currentUser: { uid: 'user-1' },
    loggedUser: {
        uid: 'user-1',
        projectIds: ['p1'],
        archivedProjectIds: [],
        templateProjectIds: [],
        guideProjectIds: [],
    },
    loggedUserProjects: [{ id: 'p1' }],
    selectedProjectIndex: -1,
    filteredOpenTasksStore: {},
    initialLoadingEndOpenTasks: {},
    initialLoadingEndObservedTasks: {},
})

describe('scheduleAfterInitialTaskData', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockState = buildState()
        mockListeners = []
    })

    afterEach(() => jest.useRealTimers())

    it('runs deferred fan-out once the scoped task board has settled', () => {
        const callback = jest.fn()
        scheduleAfterInitialTaskData(callback)

        expect(callback).not.toHaveBeenCalled()
        mockState.initialLoadingEndOpenTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())

        expect(callback).not.toHaveBeenCalled()
        mockState.initialLoadingEndObservedTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())

        expect(callback).not.toHaveBeenCalled()
        jest.advanceTimersByTime(TASK_DATA_SETTLE_GRACE_MS)
        expect(callback).toHaveBeenCalledTimes(1)
        expect(mockListeners).toHaveLength(0)
        jest.advanceTimersByTime(DEFERRED_STARTUP_WORK_FALLBACK_MS)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('does not release fan-out for the first empty project on a multi-project board', () => {
        mockState.loggedUser.projectIds = ['p1', 'p2']
        mockState.loggedUserProjects = [{ id: 'p1' }, { id: 'p2' }]
        const callback = jest.fn()
        scheduleAfterInitialTaskData(callback)

        mockState.initialLoadingEndOpenTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())
        expect(callback).not.toHaveBeenCalled()

        mockState.initialLoadingEndObservedTasks['p1user-1'] = true
        mockState.initialLoadingEndOpenTasks['p2user-1'] = true
        mockState.initialLoadingEndObservedTasks['p2user-1'] = true
        mockListeners.forEach(listener => listener())

        expect(callback).not.toHaveBeenCalled()
        jest.advanceTimersByTime(TASK_DATA_SETTLE_GRACE_MS)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('uses the bounded fallback when no task board publishes', () => {
        const callback = jest.fn()
        scheduleAfterInitialTaskData(callback)

        jest.advanceTimersByTime(DEFERRED_STARTUP_WORK_FALLBACK_MS - 1)
        expect(callback).not.toHaveBeenCalled()
        jest.advanceTimersByTime(1)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(mockListeners).toHaveLength(0)
    })

    it('accepts a longer settle window for expensive background maintenance', () => {
        const callback = jest.fn()
        scheduleAfterInitialTaskData(callback, { settleMs: 8000 })

        mockState.filteredOpenTasksStore['p1user-1'] = [['TODAY', 1]]
        mockState.initialLoadingEndOpenTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())
        jest.advanceTimersByTime(7999)
        expect(callback).not.toHaveBeenCalled()

        jest.advanceTimersByTime(1)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('does not treat a restored cold-start projection as a live task snapshot', () => {
        const callback = jest.fn()
        mockState.filteredOpenTasksStore['p1user-1'] = [['TODAY', 1]]
        scheduleAfterInitialTaskData(callback)

        mockListeners.forEach(listener => listener())
        jest.advanceTimersByTime(TASK_DATA_SETTLE_GRACE_MS)
        expect(callback).not.toHaveBeenCalled()

        mockState.initialLoadingEndOpenTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())
        jest.advanceTimersByTime(TASK_DATA_SETTLE_GRACE_MS)
        expect(callback).toHaveBeenCalledTimes(1)
    })
})
