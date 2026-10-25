import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import AppContent from '../AppContent'
import { setAnnaLayout } from '../utils/annaMode'
import { setWorkspaceViewport } from '../utils/workspaceViewport'

const mockNewDayMounted = jest.fn()
const mockNewDayUnmounted = jest.fn()

// Exercise the real app-level mounting and overlay hosts without starting auth,
// network subscriptions or the route tree. Individual dialog flows have their
// own mounted-component coverage in FloatModals/EndDayStatisticsModal.test.js.
jest.mock('../components/UIComponents/FloatModals/EndDayStatisticsModal', () => () => {
    const React = require('react')
    React.useEffect(() => {
        mockNewDayMounted()
        return mockNewDayUnmounted
    }, [])
    return <button>Start new day</button>
})
jest.mock('../components/UIComponents/GlobalModalsContainerApp', () => () => (
    <input aria-label="Global dialog draft" defaultValue="Keep my draft" />
))
jest.mock('../components/Analytics/AnalyticsConsentManager', () => () => null)
jest.mock('../components/Undo/UndoActionBar', () => () => null)
jest.mock('../AppNavigator', () => ({
    AppContainer: require('react').forwardRef(() => <button>Assistant sidebar</button>),
}))
jest.mock('../components/LoadingScreen', () => () => null)
jest.mock('../components/ProgressiveLoadingScreen', () => () => null)
jest.mock('../components/InitLoadView/InitLoadView', () => () => null)
jest.mock('../components/InitLoadView/InFocusTaskWatcher', () => () => null)
jest.mock('../components/MyDayView/MyDayLoaders/MyDayTasksLoaders', () => () => null)
jest.mock('../components/UIComponents/ShortcutCheatSheet/Shortcuts', () => () => null)
jest.mock('../redux/store', () => ({ getState: () => ({}), dispatch: jest.fn() }))
jest.mock('../redux/actions', () => ({}))
jest.mock('../utils/BackendBridge', () => ({ initFirebase: jest.fn() }))
jest.mock('../utils/NavigationService', () => ({ setTopLevelNavigator: jest.fn() }))
jest.mock('../utils/SharedHelper', () => ({ matchesPublicPageUrl: () => false }))
jest.mock('../utils/Observers', () => ({}))
jest.mock('../utils/NotesOfflinePrefetch', () => ({}))
jest.mock('../utils/NotesOfflineCatchUp', () => ({}))
jest.mock('../utils/Geolocation/GeolocationHelper', () => ({ initIpRegistry: jest.fn() }))
jest.mock('../utils/InitialLoad/newUserHelper', () => ({}))
jest.mock('../utils/InitialLoad/loggedUserHelper', () => ({}))
jest.mock('../utils/InitialLoad/bootIntegrityHealer', () => ({}))
jest.mock('../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../URLSystem/URLTrigger', () => ({}))
jest.mock('../utils/iosShareExtensionCredential', () => ({
    ensureIosShareExtensionCredential: () => Promise.resolve(),
}))
jest.mock('../utils/webShareTarget', () => ({
    loadPendingWebShareTarget: () => null,
    cleanWebShareTargetParamsFromCurrentUrl: jest.fn(),
}))
jest.mock('../hooks/useDeferredStartupWork', () => ({
    __esModule: true,
    default: () => false,
    useInitialTaskDataPublished: () => false,
}))
jest.mock('../utils/typesenseSearch', () => ({}))
jest.mock('../utils/performance/performanceLogger', () => ({
    schedulePerformanceAfterPaint: () => () => {},
}))
jest.mock('../utils/performance/userWaitConnection', () => ({ finishAppBootConnectionWait: jest.fn() }))

const pane = { top: 72, left: 520, width: 920, height: 828 }
const initialState = {
    loggedIn: true,
    loggedUser: { uid: 'user' },
    processedInitialURL: true,
    route: 'Root',
}

function Harness({ state = initialState }) {
    const store = React.useMemo(() => createStore(() => state), [state])
    return (
        <Provider store={store}>
            <AppContent />
        </Provider>
    )
}

beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState({}, '', '/projects/tasks/open')
})

afterEach(() => {
    cleanup()
    setWorkspaceViewport(null)
    setAnnaLayout('alldone')
    localStorage.clear()
})

it('keeps one New Day instance and the same global draft across assistant layout changes', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Start new day' })
    const draft = screen.getByLabelText('Global dialog draft')
    draft.value = 'Unsaved changes'

    for (const layout of ['split', 'chat', 'alldone', 'split']) {
        act(() => {
            setAnnaLayout(layout)
            setWorkspaceViewport(layout === 'alldone' ? null : pane, layout !== 'chat')
        })
        expect(screen.getAllByText('Start new day')).toHaveLength(1)
        expect(screen.getByText('Start new day')).toBe(button)
        expect(screen.getByLabelText('Global dialog draft')).toBe(draft)
        expect(draft.value).toBe('Unsaved changes')
        expect(mockNewDayMounted).toHaveBeenCalledTimes(1)
        expect(mockNewDayUnmounted).not.toHaveBeenCalled()
    }
})

it.each([
    { ...initialState, loggedIn: false },
    { ...initialState, processedInitialURL: false },
])('waits for login and initial URL processing before mounting authenticated dialogs', state => {
    render(<Harness state={state} />)
    expect(screen.queryByText('Start new day')).toBeNull()
    expect(screen.queryByLabelText('Global dialog draft')).toBeNull()
    expect(mockNewDayMounted).not.toHaveBeenCalled()
})

// The reload host chooses its own pane/browser scope. An outer workspace host
// would hide it again in chat-only mode, regardless of its own visibility.
it('does not nest the global dialog host inside the hidden workspace layer', () => {
    setWorkspaceViewport(pane, false)
    render(<Harness />)
    expect(screen.getByLabelText('Global dialog draft').closest('[data-testid="workspace-overlay-layer"]')).toBeNull()
})
