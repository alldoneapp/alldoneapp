import { ROOT_ROUTES } from '../TabNavigationConstants'
import { getAnalyticsPagePath } from '../analytics/analytics'
import { schedulePerformanceAfterPaint, startPerformanceTrace } from './performanceLogger'

const PAGE_SETTLE_GRACE_MS = 250
const PAGE_TRACE_TIMEOUT_MS = 30000

let installed = false

const getScope = state => (state.selectedProjectIndex === -1 ? 'all_projects' : 'single_project')

export const installStorePerformanceObserver = store => {
    if (installed || !store || typeof store.subscribe !== 'function') return () => {}
    installed = true

    let state = store.getState()
    let lastRoute = state.route
    let lastSidebarTab = state.selectedSidebarTab
    let lastLoadingCount = state.isLoadingData || 0
    let activePage = null

    const closeActivePage = (phase, metadata = {}) => {
        if (!activePage) return
        activePage.cancelAfterPaint?.()
        clearTimeout(activePage.settleTimer)
        clearTimeout(activePage.timeout)
        activePage.trace.end(phase, metadata)
        activePage = null
    }

    const scheduleReadyCheck = expectedPage => {
        if (!activePage || activePage.pagePath !== expectedPage) return
        activePage.cancelAfterPaint?.()
        activePage.cancelAfterPaint = schedulePerformanceAfterPaint(() => {
            if (!activePage || activePage.pagePath !== expectedPage) return
            activePage.trace.mark('paint_committed')
            clearTimeout(activePage.settleTimer)
            activePage.settleTimer = setTimeout(() => {
                if (!activePage || activePage.pagePath !== expectedPage) return
                if ((store.getState().isLoadingData || 0) === 0) {
                    closeActivePage('page_ready', { outcome: 'success' })
                }
            }, PAGE_SETTLE_GRACE_MS)
        })
    }

    const startPage = routeKey => {
        const pagePath = getAnalyticsPagePath(routeKey)
        if (activePage && activePage.pagePath === pagePath) return
        closeActivePage('navigation_replaced', { outcome: 'cancelled' })
        const currentState = store.getState()
        const trace = startPerformanceTrace('page_load', {
            page_path: pagePath,
            scope: getScope(currentState),
            project_count: Array.isArray(currentState.loggedUser?.projectIds)
                ? currentState.loggedUser.projectIds.length
                : 0,
        })
        // This trace deliberately stays performance-only. It includes React rendering,
        // paints, and loading-refcount settlement, so using it as a connection sample can
        // label a CPU-heavy page (notably All Projects Notes) as "Slow connection" even
        // after Firestore already answered. Individual snapshot gates own network health.
        trace.mark('navigation_started', { watcher_count: currentState.isLoadingData || 0 })
        activePage = {
            pagePath,
            trace,
            timeout: setTimeout(() => closeActivePage('page_timeout', { outcome: 'timeout' }), PAGE_TRACE_TIMEOUT_MS),
            settleTimer: null,
            cancelAfterPaint: null,
        }
        scheduleReadyCheck(pagePath)
    }

    const unsubscribe = store.subscribe(() => {
        const nextState = store.getState()
        const sidebarChanged = nextState.selectedSidebarTab !== lastSidebarTab
        const routeChanged = nextState.route !== lastRoute

        if (sidebarChanged && ROOT_ROUTES.includes(nextState.selectedSidebarTab)) {
            startPage(nextState.selectedSidebarTab)
        }
        if (routeChanged && nextState.route) startPage(nextState.route)

        const loadingCount = nextState.isLoadingData || 0
        if (activePage && loadingCount > 0 && lastLoadingCount === 0) {
            clearTimeout(activePage.settleTimer)
            activePage.trace.mark('data_loading_started', { watcher_count: loadingCount })
        }
        if (activePage && loadingCount === 0 && lastLoadingCount > 0) {
            scheduleReadyCheck(activePage.pagePath)
        }

        lastRoute = nextState.route
        lastSidebarTab = nextState.selectedSidebarTab
        lastLoadingCount = loadingCount
        state = nextState
    })

    return () => {
        unsubscribe()
        closeActivePage('observer_removed', { outcome: 'cancelled' })
        installed = false
    }
}

export const __resetStorePerformanceObserverForTests = () => {
    installed = false
}
