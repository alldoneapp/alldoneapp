jest.mock('../analytics/analytics', () => ({
    getAnalyticsPagePath: jest.fn(route => `/page/${route}`),
}))

const mockTrace = {
    mark: jest.fn(),
    end: jest.fn(),
}

jest.mock('./performanceLogger', () => ({
    startPerformanceTrace: jest.fn(() => mockTrace),
    schedulePerformanceAfterPaint: jest.fn(callback => {
        callback()
        return jest.fn()
    }),
}))

import { startPerformanceTrace } from './performanceLogger'
import { __resetStorePerformanceObserverForTests, installStorePerformanceObserver } from './storePerformanceObserver'

const createStore = initialState => {
    let state = initialState
    const listeners = new Set()
    return {
        getState: () => state,
        subscribe: callback => {
            listeners.add(callback)
            return () => listeners.delete(callback)
        },
        setState: update => {
            state = { ...state, ...update }
            listeners.forEach(listener => listener())
        },
    }
}

describe('store performance observer', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        __resetStorePerformanceObserverForTests()
    })

    afterEach(() => jest.useRealTimers())

    test('measures a root page through loading completion and the following paint', () => {
        const store = createStore({
            route: '',
            selectedSidebarTab: '',
            selectedProjectIndex: -1,
            isLoadingData: 0,
            loggedUser: { projectIds: ['p1', 'p2'] },
        })
        const unsubscribe = installStorePerformanceObserver(store)

        store.setState({ selectedSidebarTab: 'ROOT_TASKS' })
        store.setState({ isLoadingData: 2 })
        store.setState({ isLoadingData: 0 })
        jest.advanceTimersByTime(250)

        expect(startPerformanceTrace).toHaveBeenCalledWith('page_load', {
            page_path: '/page/ROOT_TASKS',
            scope: 'all_projects',
            project_count: 2,
        })
        expect(mockTrace.mark).toHaveBeenCalledWith('data_loading_started', { watcher_count: 2 })
        expect(mockTrace.end).toHaveBeenCalledWith('page_ready', { outcome: 'success' })

        unsubscribe()
    })
})
