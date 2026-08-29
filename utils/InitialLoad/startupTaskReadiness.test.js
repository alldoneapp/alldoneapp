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

const { DEFERRED_STARTUP_WORK_FALLBACK_MS, scheduleAfterInitialTaskData } = require('./startupTaskReadiness')

const buildState = () => ({
    currentUser: { uid: 'user-1' },
    loggedUser: { uid: 'user-1', projectIds: ['p1'] },
    loggedUserProjects: [{ id: 'p1' }],
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

    it('runs deferred fan-out as soon as the first task stream publishes', () => {
        const callback = jest.fn()
        scheduleAfterInitialTaskData(callback)

        expect(callback).not.toHaveBeenCalled()
        mockState.initialLoadingEndOpenTasks['p1user-1'] = true
        mockListeners.forEach(listener => listener())

        expect(callback).toHaveBeenCalledTimes(1)
        expect(mockListeners).toHaveLength(0)
        jest.advanceTimersByTime(DEFERRED_STARTUP_WORK_FALLBACK_MS)
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
})
