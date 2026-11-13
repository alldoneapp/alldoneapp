import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
let testRoot
let testContainer
const screen = {
    getByLabelText: label => document.querySelector(`[aria-label="${label}"]`),
    getByText: text =>
        [...document.querySelectorAll('button, span, strong')].find(node => node.textContent.trim() === text),
}
const fireEvent = {
    change: (element, event) => {
        element.value = event.target.value
    },
    click: element => act(() => element.click()),
}
const render = element => {
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
    testRoot = createRoot(testContainer)
    act(() => testRoot.render(element))
    return { rerender: next => act(() => testRoot.render(next)) }
}
afterEach(() => {
    act(() => testRoot?.unmount())
    testContainer?.remove()
})
import AnnaShell from './AnnaShell'
import useAnnaConversation from './useAnnaConversation'
import URLTrigger from '../../URLSystem/URLTrigger'
import { resolveAnnaActivityPath } from './annaActivityNavigation'
import NavigationService from '../../utils/NavigationService'
import { restoreAnnaLayout, setAnnaMode, setAnnaLayout } from '../../utils/annaMode'
import AnnaBrowserTakeoverContext from './AnnaBrowserTakeoverContext'
import AnnaWorkspaceNavigationContext from './AnnaWorkspaceNavigationContext'
import LoggedUserSidebarHeader from '../SidebarMenu/LoggedUserSidebar/LoggedUserSidebarHeader'
import ProjectItem from '../SidebarMenu/ProjectFolding/ProjectItem/ProjectItem'
import AssistantModeButton from './AssistantModeButton'
jest.mock('../SidebarMenu/Themes', () => ({
    Themes: {
        modern: {
            CustomSideMenu: {
                Header: {},
                AllProjects: {},
                ProjectList: { ProjectItem: { container: () => ({}), containerActive: () => ({}) } },
            },
        },
    },
}))
jest.mock('../SidebarMenu/ProjectFolding/ProjectItem/ProjectItemIcon', () => () => null)
jest.mock('../SidebarMenu/ProjectFolding/ProjectItem/ProjectItemName', () => ({ projectName }) => (
    <span>{projectName}</span>
))
jest.mock('../SidebarMenu/ProjectFolding/ProjectItem/ProjectRightArea', () => () => null)
jest.mock('../SidebarMenu/ProjectFolding/ProjectSectionList', () => () => null)
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    ALL_PROJECTS_INDEX: -1,
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({ updateShowAllProjectsByTime: jest.fn() }))
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({
            loggedUser: mockUser,
            smallScreenNavigation: mockMobileNavigation,
            route: 'Root',
            ...mockWorkspaceState,
        }),
    },
}))

// AT-3036: what the Alldone workspace shows (redux), for the workspace sync.
let mockWorkspaceState = {}
let mockCallStatus = 'idle'
const mockSet = jest.fn().mockResolvedValue(undefined)
const mockSnapshots = {}
let mockBrowserProps
let mockConversationProps
const mockScrollToLatest = jest.fn()
let mockTransactionState
let mockTakeoverProps
let mockTakeoverMounts = 0
let mockVmJobs = []
let mockVmError = false
// The selected VM card (a thread since AT-2916) and the run that card last showed.
let mockSelectedRunId
let mockSelectedCardRunId
const mockRetryVms = jest.fn()
jest.mock('./useAnnaVmJobs', () => ({
    __esModule: true,
    default: (userId, { selectedId, selectedRunId }) => {
        mockSelectedRunId = selectedId
        mockSelectedCardRunId = selectedRunId
        return { jobs: mockVmJobs, error: mockVmError, retry: mockRetryVms }
    },
    vmJobPath: job => `/projects/${job.projectId}/tasks/${job.objectId}/chat`,
}))
jest.mock('./AnnaVmWorkspace', () => ({
    __esModule: true,
    default: ({ job, active }) => (
        <div data-active={active}>
            Live VM {job.title}
            <textarea aria-label={`Feedback for ${job.title}`} />
        </div>
    ),
}))
const mockReleaseBrowser = jest.fn()
const mockRunTransaction = jest.fn()
jest.mock('./AnnaBrowserWorkspace', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        mockBrowserProps = props
        React.useImperativeHandle(ref, () => ({ releaseControl: mockReleaseBrowser }))
        return null
    })
})
jest.mock('./AnnaWorkspaceHighlight', () => () => null)
jest.mock('../ChatsView/ChatDV/EditorView/BrowserTakeoverPanel', () => props => {
    mockTakeoverProps = props
    const React = require('react')
    React.useEffect(() => {
        mockTakeoverMounts++
    }, [])
    return <input aria-label="Private login input" />
})
const mockUpdate = jest.fn().mockResolvedValue(undefined)
const mockUser = { uid: 'u1', gold: 100, displayName: 'Test user', sidebarExpanded: true }
const mockDispatch = jest.fn()
let mockMobileNavigation = false
let mockAssistant
let mockSidebarNumbers
let mockDefaultAssistant
let mockUnmounts = 0
let mockProjectsMap = {}
let mockExtraAssistants = {}
jest.mock('react-redux', () => ({
    shallowEqual: (a, b) => a === b,
    useDispatch: () => mockDispatch,
    useSelector: selector =>
        selector({
            loggedUser: mockUser,
            currentUser: mockUser,
            selectedProjectIndex: -1,
            defaultAssistant: mockDefaultAssistant,
            projectAssistants: { p1: [mockAssistant], ...mockExtraAssistants },
            loggedUserProjectsMap: mockProjectsMap,
            sidebarNumbers: mockSidebarNumbers,
            smallScreenNavigation: mockMobileNavigation,
            ...mockWorkspaceState,
        }),
}))
jest.mock('./useAnnaConversation', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./AnnaConversation', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: React.forwardRef((props, ref) => {
            mockConversationProps = props
            mockAppPane = React.useContext(require('./AnnaAppPaneContext').default)
            const input = React.useRef(null)
            React.useImperativeHandle(ref, () => ({
                scrollToLatest: mockScrollToLatest,
                focusInput: () => input.current?.focus(),
            }))
            React.useEffect(
                () => () => {
                    mockUnmounts++
                },
                []
            )
            return <textarea ref={input} aria-label="Persistent conversation" />
        }),
    }
})
// The app views (MCP Apps, e.g. Judy) in the right pane: the frame is a stub that exposes the close
// request a view's own "show in chat" button sends; which app a view belongs to is the real rule.
const mockAppFrames = {}
let mockAppPane
jest.mock('../ChatsView/ChatDV/EditorView/McpAppViews', () => ({
    McpAppFrame: props => {
        mockAppFrames[props.view.viewId] = props
        return <div data-testid={`app-frame-${props.view.viewId}`} />
    },
    mcpAppKey: jest.requireActual('../ChatsView/ChatDV/EditorView/McpAppViews').mcpAppKey,
}))
// Embedded web apps (pre-configured iframe tasks) handed over from their window (AT-2951).
const mockEmbeddedFrames = {}
jest.mock('../UIComponents/FloatModals/IframeModal/EmbeddedAppFrame', () => props => {
    mockEmbeddedFrames[props.url] = props
    return <div data-testid={`embedded-frame-${props.url}`} />
})
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => mockAssistant }))
jest.mock('../UIComponents/AssistantVoiceCallProvider', () => ({
    useVoiceCall: () => ({ status: mockCallStatus, voiceSeconds: 0 }),
}))
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({
        runTransaction: fn => mockRunTransaction(fn),
        doc: path => ({
            update: mockUpdate,
            set: mockSet,
            onSnapshot: callback => {
                mockSnapshots[path] = callback
                return () => delete mockSnapshots[path]
            },
        }),
    }),
}))
jest.mock('../../utils/NavigationService', () => ({
    __esModule: true,
    default: { createNavigationProp: () => ({}), navigate: jest.fn() },
}))
jest.mock('../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('../../redux/actions', () => ({
    showGlobalSearchPopup: () => ({ type: 'SEARCH' }),
    hideWebSideBar: () => ({ type: 'HIDE_SIDEBAR' }),
    hideFloatPopup: () => ({ type: 'HIDE_FLOAT_POPUP' }),
    showFloatPopup: () => ({ type: 'SHOW_FLOAT_POPUP' }),
    hideGlobalSearchPopup: () => ({ type: 'HIDE_SEARCH' }),
    setGlobalSearchResults: results => ({ type: 'SEARCH_RESULTS', results }),
    navigateToAllProjectsTasks: options => ({ type: 'ALL_PROJECTS_TASKS', options }),
    storeLoggedUser: user => ({ type: 'LOGGED_USER', user }),
    switchProject: index => ({ type: 'PROJECT', index }),
    updateFeedActiveTab: tab => ({ type: 'FEED_TAB', tab }),
    storeCurrentUser: user => ({ type: 'CURRENT_USER', user }),
    setSelectedTypeOfProject: projectType => ({ type: 'PROJECT_TYPE', projectType }),
    switchShortcutProject: index => ({ type: 'SHORTCUT_PROJECT', index }),
    setSearchText: text => ({ type: 'SEARCH_TEXT', text }),
    resetNotesAmounts: () => ({ type: 'RESET_NOTES_AMOUNTS' }),
    setSelectedSidebarTab: tab => ({ type: 'SIDEBAR_TAB', tab }),
    setTaskViewToggleIndex: index => ({ type: 'TASK_INDEX', index }),
    setTaskViewToggleSection: section => ({ type: 'TASK_SECTION', section }),
}))
jest.mock('./annaActivityNavigation', () => ({
    resolveAnnaActivityPath: jest.fn(async path => ({ path })),
    getAnnaTargetErrorMessage: reason => `target:${reason}`,
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? ''),
    useTranslator: () => {},
}))

const conversation = { id: 'anna_u1', projectId: 'p1', assistantId: 'a1' }
const state = { conversation, loading: false, error: '', retry: jest.fn() }
const scrollView = { current: { scrollTo: jest.fn() } }
const sidebarHeader = () => <LoggedUserSidebarHeader expanded navigation={NavigationService} scrollView={scrollView} />
const assistantToggle = () => document.querySelector('[role="button"][aria-expanded]')
const WorkspaceNavigationFixture = () => (
    <button aria-label="Show Alldone with chat" onClick={React.useContext(AnnaWorkspaceNavigationContext)} />
)
const content = (id, withSidebar = false) => (
    <AnnaShell routeId={id}>
        <WorkspaceNavigationFixture />
        <AssistantModeButton inline />
        {withSidebar && sidebarHeader()}
        <input aria-label="Real workspace editor" defaultValue="Unsaved note" />
    </AnnaShell>
)

const selectedSurface = () => document.querySelector('.anna-header-picker select').value
const choose = (selector, value) =>
    act(() => {
        selector.value = value
        selector.dispatchEvent(new Event('change', { bubbles: true }))
    })
const chooseSurface = value => {
    choose(document.querySelector('.anna-header-picker select'), value.startsWith('vm:') ? 'vms' : value)
    if (value.startsWith('vm:')) {
        const job = mockVmJobs.find(job => job.id === value.slice(3))
        act(() => screen.getByLabelText(job.title).focus())
    }
}
const showChat = () => choose(document.querySelector('.anna-header-picker select'), 'chat')
const showWorkspace = () => fireEvent.click(screen.getByLabelText('Show workspace'))
const showAlldoneWorkspace = () => fireEvent.click(screen.getByLabelText('Show Alldone with chat'))
const closeAssistant = () => {
    const taskButton = document.querySelector('.anna-header-tasks')
    if (taskButton) fireEvent.click(taskButton)
    else {
        showAlldoneWorkspace()
        fireEvent.click(screen.getByLabelText('Anna Alldone: Close assistant chat'))
    }
}

it.each(
    [false, true].flatMap(mobile =>
        [
            ['top bar', 'first open'],
            ['sidebar', 'first open'],
            ['top bar', 'reopen'],
            ['sidebar', 'reopen'],
            ['top bar', 'workspace'],
        ]
            .filter(([, start]) => mobile || start !== 'workspace')
            .map(([entry, start]) => [mobile, entry, start])
    )
)('scrolls and focuses within the gesture (mobile: %s) from the %s on %s', (mobile, entry, start) => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({ matches: mobile, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    try {
        if (start === 'first open') setAnnaMode(false)
        render(content(1, true))
        const workspace = screen.getByLabelText('Real workspace editor')
        workspace.value = 'Keep my note'
        if (start === 'reopen') closeAssistant()
        else if (start === 'workspace') showAlldoneWorkspace()
        const previousChat = screen.getByLabelText('Persistent conversation')
        if (previousChat) previousChat.value = 'Keep my chat draft'
        mockScrollToLatest.mockClear()
        const button =
            entry === 'sidebar' ? assistantToggle() : document.querySelector('[data-testid="top-bar-assistant-mode"]')
        act(() => {
            button.click()
            // Assert before React flushes work at the end of act: focus must
            // happen inside the actual handler, while iOS allows the keyboard.
            const chat = screen.getByLabelText('Persistent conversation')
            expect(document.activeElement).toBe(chat)
            expect(chat.closest('section').hasAttribute('inert')).toBe(false)
            expect(mockScrollToLatest).toHaveBeenCalledTimes(1)
        })
        if (previousChat) {
            expect(screen.getByLabelText('Persistent conversation')).toBe(previousChat)
            expect(previousChat.value).toBe('Keep my chat draft')
        }
        expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
        expect(workspace.value).toBe('Keep my note')
        expect(mockUnmounts).toBe(0)
        expect(document.activeElement).toBe(screen.getByLabelText('Persistent conversation'))
    } finally {
        window.matchMedia = originalMatchMedia
    }
})

it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
])('handles an async conversation (mobile: %s) with chat focus retained: %s', (mobile, retainFocus) => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({ matches: mobile, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    try {
        setAnnaMode(false)
        useAnnaConversation.mockReturnValue({ ...state, conversation: null, loading: true })
        const view = render(content(1))
        fireEvent.click(document.querySelector('[data-testid="top-bar-assistant-mode"]'))
        expect(document.activeElement).toBe(document.querySelector('.anna-conversation'))
        const workspace = screen.getByLabelText('Real workspace editor')
        if (!retainFocus) act(() => workspace.focus())
        useAnnaConversation.mockReturnValue(state)
        view.rerender(content(1))
        expect(document.activeElement).toBe(retainFocus ? screen.getByLabelText('Persistent conversation') : workspace)
        // Async scrolling belongs to the real conversation's activation lifecycle,
        // tested in AnnaConversation.test.js; focus remains guarded here.
    } finally {
        window.matchMedia = originalMatchMedia
    }
})

it.each(['top bar', 'sidebar'])('scrolls on every deactivate/reactivate cycle via the %s', entry => {
    setAnnaMode(false)
    render(content(1, true))
    for (let cycle = 0; cycle < 3; cycle++) {
        mockScrollToLatest.mockClear()
        fireEvent.click(
            entry === 'sidebar' ? assistantToggle() : document.querySelector('[data-testid="top-bar-assistant-mode"]')
        )
        expect(mockScrollToLatest).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(screen.getByLabelText('Persistent conversation'))
        closeAssistant()
    }
})

it('preserves editors and the selected surface while hiding the workspace, including background browser activity', () => {
    render(content(1))
    const workspace = screen.getByLabelText('Real workspace editor')
    const chat = screen.getByLabelText('Persistent conversation')
    chat.value = 'Keep my message'
    workspace.value = 'Keep my note'
    chooseSurface('browser')
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    expect(document.querySelector('.anna-chat-only')).toBeTruthy()
    expect(screen.getByLabelText('Alldone workspace').hasAttribute('inert')).toBe(true)
    expect(mockBrowserProps.active).toBe(false)
    startBrowserActivity('background', 'brun_new')
    expect(document.querySelector('.anna-chat-only')).toBeTruthy()
    showWorkspace()
    expect(selectedSurface()).toBe('browser')
    expect(mockBrowserProps.active).toBe(true)
    expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
    expect(workspace.value).toBe('Keep my note')
    expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
    expect(chat.value).toBe('Keep my message')
    expect(mockUnmounts).toBe(0)
})

it('does not select a background browser while the user has hidden the Alldone workspace', () => {
    render(content(1))
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    startBrowserActivity()
    showWorkspace()
    expect(selectedSurface()).toBe('alldone')
})

it.each(['browser', 'vm:vm1'])('returns to the same Alldone page when closing chat from %s', surface => {
    mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
    render(content(1))
    const workspace = screen.getByLabelText('Real workspace editor')
    chooseSurface(surface)
    closeAssistant()
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    expect(document.querySelector('.anna-workspace').getAttribute('aria-hidden')).toBe('false')
    act(() => setAnnaMode(true))
    expect(selectedSurface()).toBe('alldone')
    expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
    expect(URLTrigger.processUrl).not.toHaveBeenCalled()
})

it('defers assistant presentation in chat-only mode until the user opens it', async () => {
    const view = render(content(1))
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    useAnnaConversation.mockReturnValue({
        ...state,
        conversation: {
            ...conversation,
            annaPresentation: {
                id: 'hidden-presentation',
                view: 'notes',
                path: '/projects/notes/all',
                title: 'Notes',
                createdAt: Date.now(),
            },
        },
    })
    view.rerender(content(1))
    expect(URLTrigger.processUrl).not.toHaveBeenCalled()
    expect(document.querySelector('.anna-conversation .anna-pending')).toBeTruthy()
    await act(async () => screen.getByText('Open').click())
    expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, '/projects/notes/all')
    expect(document.querySelector('.anna-chat-only')).toBeNull()
})

it('shows an empty VM workspace without a session dropdown', () => {
    render(content(1))
    chooseSurface('vms')
    expect(document.querySelector('.anna-vms').textContent).toContain('No VM sessions yet')
    expect(document.querySelector('.anna-header-picker select').options).toHaveLength(3)
    expect(document.querySelector('.anna-vms select')).toBeNull()
})

it('frames the workspace with the assistant accent only while a tool changes it (AT-2911, AT-2926)', async () => {
    render(content(1))
    const stage = document.querySelector('.anna-stage')
    const label = () => document.querySelector('.anna-working-label')
    expect(stage.classList.contains('anna-stage-working')).toBe(false)
    expect(label()).toBeNull()
    const report = (changingWorkspace, chatId = 'anna_u1') =>
        act(async () =>
            mockConversationProps.onWorkStateChange({
                projectId: 'p1',
                chatId,
                busy: true,
                changingWorkspace,
                completedRequests: [],
            })
        )
    // Busy without a workspace-changing tool call (thinking, streaming): default edge.
    await report(false)
    expect(stage.classList.contains('anna-stage-working')).toBe(false)
    expect(label()).toBeNull()
    await report(true)
    expect(stage.classList.contains('anna-stage-working')).toBe(true)
    expect(label().textContent).toBe('Carl Code Mentor is working here')
    await report(false)
    expect(stage.classList.contains('anna-stage-working')).toBe(false)
    expect(label()).toBeNull()
    // Another conversation's tool call never lights this workspace.
    await report(true, 'other')
    expect(label()).toBeNull()
    // Sending a message alone is not a tool call.
    await act(async () => mockConversationProps.onSendingChange(true))
    expect(stage.classList.contains('anna-stage-working')).toBe(false)
    expect(label()).toBeNull()
    // Hidden workspace: nothing to frame.
    await report(true)
    expect(label()).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    expect(label()).toBeNull()
})

it('saves keyboard resizing independently of pane visibility', () => {
    render(content(1))
    const divider = document.querySelector('.anna-divider')
    const initial = Number(divider.getAttribute('aria-valuenow'))
    act(() => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(Number(divider.getAttribute('aria-valuenow'))).toBe(initial + 20)
    expect(window.localStorage.getItem('anna-chat-width:u1')).toBe(String(initial + 20))
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    showWorkspace()
    expect(Number(divider.getAttribute('aria-valuenow'))).toBe(initial + 20)
})

it.each(['edit', 'zoom'])('cancels pending result navigation when the user chooses to %s', async action => {
    jest.useFakeTimers()
    const visibility = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const change = {
        id: 'saved1',
        projectId: 'p1',
        objectId: 'task1',
        type: 'task',
        change: 'created',
        path: '/projects/p1/tasks/task1/properties',
        expiresAt: Date.now() + 120000,
    }
    useAnnaConversation.mockReturnValue({ ...state, conversation: { ...conversation, annaWorkspaceChanges: [change] } })
    try {
        render(content(1))
        await act(async () => {})
        if (action === 'edit') {
            act(() =>
                screen
                    .getByLabelText('Real workspace editor')
                    .dispatchEvent(new Event('pointerdown', { bubbles: true }))
            )
        } else act(() => setAnnaMode(false))
        for (let i = 0; i < 12; i++) await act(async () => jest.advanceTimersByTime(75))
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    } finally {
        visibility.mockRestore()
        jest.useRealTimers()
    }
})

it('still supports a legacy saved-object cue without a list route', async () => {
    jest.useFakeTimers()
    const visibility = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const change = {
        id: 'saved1',
        projectId: 'p1',
        objectId: 'task1',
        type: 'task',
        change: 'updated',
        path: '/projects/p1/tasks/task1/properties',
        expiresAt: Date.now() + 120000,
    }
    useAnnaConversation.mockReturnValue({ ...state, conversation: { ...conversation, annaWorkspaceChanges: [change] } })
    try {
        render(content(1))
        await act(async () => {})
        for (let i = 0; i < 10; i++) await act(async () => jest.advanceTimersByTime(75))
        expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, change.path)
        expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    } finally {
        visibility.mockRestore()
        jest.useRealTimers()
    }
})

it.each(['mounted', 'delayed', 'missing', 'interrupted'])(
    'keeps a created task in its list when the row is %s',
    async outcome => {
        jest.useFakeTimers()
        const visibility = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
        const change = {
            id: 'saved1',
            projectId: 'p1',
            objectId: 'task1',
            type: 'task',
            change: 'created',
            path: '/projects/p1/tasks/task1/properties',
            listPath: '/projects/p1/user/assistant1/tasks/open',
            expiresAt: Date.now() + 120000,
        }
        useAnnaConversation.mockReturnValue({
            ...state,
            conversation: { ...conversation, annaWorkspaceChanges: [change] },
        })
        try {
            render(content(1))
            await act(async () => {})
            for (let i = 0; i < 10; i++) await act(async () => jest.advanceTimersByTime(75))
            expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual([change.listPath])
            if (outcome === 'mounted') {
                // A fresh list subscription delivers its row after navigation.
                const row = document.createElement('div')
                Object.assign(row.dataset, { annaObjectType: 'task', annaObjectId: 'task1', annaProjectId: 'p1' })
                row.getBoundingClientRect = () => ({ width: 200, height: 40 })
                document.querySelector('.anna-workspace-content').append(row)
            } else if (outcome === 'interrupted') {
                act(() =>
                    screen
                        .getByLabelText('Real workspace editor')
                        .dispatchEvent(new Event('pointerdown', { bubbles: true }))
                )
            }
            for (let i = 0; i < 40; i++) await act(async () => jest.advanceTimersByTime(75))
            expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual([change.listPath])
            if (outcome === 'delayed') {
                const row = document.createElement('div')
                Object.assign(row.dataset, { annaObjectType: 'task', annaObjectId: 'task1', annaProjectId: 'p1' })
                row.getBoundingClientRect = () => ({ width: 200, height: 40 })
                document.querySelector('.anna-workspace-content').append(row)
                for (let i = 0; i < 10; i++) await act(async () => jest.advanceTimersByTime(75))
                expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual([change.listPath])
            }
        } finally {
            visibility.mockRestore()
            jest.useRealTimers()
        }
    }
)

it.each(['home', 'browser'])(
    'finishes a reveal at %s, retaining assistant mode, the chat draft and manual surface selection',
    async destination => {
        jest.useFakeTimers()
        const visibility = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
        const geometry = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 400,
            top: 100,
            right: 1000,
            bottom: 500,
            width: 600,
            height: 400,
        })
        const change = {
            id: 'saved1',
            projectId: 'p1',
            objectId: 'task1',
            type: 'task',
            change: 'created',
            path: '/projects/p1/tasks/task1/properties',
            expiresAt: Date.now() + 120000,
            triggerMessageId: 'request1',
        }
        useAnnaConversation.mockReturnValue({
            ...state,
            conversation: { ...conversation, annaWorkspaceChanges: [change] },
        })
        try {
            render(
                <AnnaShell routeId={1}>
                    <div data-anna-object-type="task" data-anna-project-id="p1" data-anna-object-id="task1">
                        Saved task
                    </div>
                </AnnaShell>
            )
            await act(async () => {
                mockConversationProps.onSendingChange(true)
                mockConversationProps.onWorkStateChange({
                    projectId: 'p1',
                    chatId: 'anna_u1',
                    busy: false,
                    completedRequests: ['request1'],
                })
            })
            screen.getByLabelText('Persistent conversation').value = 'Unsent next message'
            for (let i = 0; i < 80; i++) await act(async () => jest.advanceTimersByTime(50))
            expect(URLTrigger.processUrl).not.toHaveBeenCalled()
            if (destination === 'browser') chooseSurface('browser')
            await act(async () => mockConversationProps.onSendingChange(false))
            if (destination === 'home') expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, '/projects/tasks/open')
            else expect(URLTrigger.processUrl).not.toHaveBeenCalled()
            expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
            expect(screen.getByLabelText('Persistent conversation').value).toBe('Unsent next message')
        } finally {
            visibility.mockRestore()
            geometry.mockRestore()
            jest.useRealTimers()
        }
    }
)

beforeEach(() => {
    mockWorkspaceState = {}
    mockMobileNavigation = false
    mockSidebarNumbers = {}
    global.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    setAnnaMode(true)
    mockAssistant = { uid: 'a1', displayName: 'Carl Code Mentor' }
    mockDefaultAssistant = { uid: 'anna', displayName: 'Anna Alldone' }
    mockProjectsMap = {}
    mockExtraAssistants = {}
    mockUnmounts = 0
    mockBrowserProps = null
    mockConversationProps = null
    mockTransactionState = {}
    mockTakeoverProps = null
    mockTakeoverMounts = 0
    mockVmJobs = []
    mockVmError = false
    jest.clearAllMocks()
    mockReleaseBrowser.mockResolvedValue(undefined)
    mockRunTransaction.mockImplementation(fn =>
        fn({ get: async () => ({ data: () => mockTransactionState }), set: mockSet })
    )
    useAnnaConversation.mockReturnValue(state)
})

const startBrowserActivity = (commentId = 'answer1', runId = 'brun_1') => {
    act(() =>
        mockSnapshots['users/u1/private/annaBrowser']({
            exists: true,
            data: () => ({
                runId,
                updatedAt: Date.now(),
                activity: { projectId: 'p1', objectId: 'anna_u1', objectType: 'topics', commentId },
            }),
        })
    )
    return status =>
        act(() =>
            mockSnapshots[`chatComments/p1/topics/anna_u1/comments/${commentId}`]({
                exists: true,
                data: () => ({ assistantRun: { status }, isLoading: status === 'running' }),
            })
        )
}

it('returns to the same Alldone view only when the browsing request finishes, including a reused browser', () => {
    const visible = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    try {
        render(content(1))
        const input = screen.getByLabelText('Real workspace editor')
        input.value = 'Unsent edit'
        const update = startBrowserActivity()
        update('running')
        expect(String(selectedSurface() === 'browser')).toBe('true')
        update('awaiting_user')
        expect(String(selectedSurface() === 'browser')).toBe('true')
        update('completed')
        expect(String(selectedSurface() === 'alldone')).toBe('true')
        expect(screen.getByLabelText('Real workspace editor')).toBe(input)
        expect(input.value).toBe('Unsent edit')
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        const second = startBrowserActivity('answer2')
        expect(String(selectedSurface() === 'browser')).toBe('true')
        second('completed')
        expect(String(selectedSurface() === 'alldone')).toBe('true')
    } finally {
        visible.mockRestore()
    }
})

it.each(['manual', 'control', 'gesture', 'vm'])('preserves the user’s %s choice when browsing finishes', choice => {
    const visible = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    try {
        mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'initiated' }]
        render(content(1))
        const update = startBrowserActivity()
        update('running')
        if (choice === 'control') act(() => mockBrowserProps.onControlChange(true))
        else if (choice === 'gesture')
            act(() =>
                document
                    .querySelector('.anna-browser-surface')
                    .dispatchEvent(new Event('pointerdown', { bubbles: true }))
            )
        else chooseSurface(choice === 'manual' ? 'browser' : 'vm:vm1')
        update('completed')
        expect(String(selectedSurface() === 'alldone')).toBe('false')
        if (choice === 'control') {
            act(() => mockBrowserProps.onSessionEnded('brun_1'))
            expect(String(selectedSurface() === 'browser')).toBe('true')
        }
    } finally {
        visible.mockRestore()
    }
})

it('ignores completion from a superseded browser and returns when the current session ends', () => {
    const visible = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    try {
        render(content(1))
        startBrowserActivity()
        const late = mockSnapshots['chatComments/p1/topics/anna_u1/comments/answer1']
        startBrowserActivity('answer2', 'brun_2')
        act(() => late({ data: () => ({ assistantRun: { status: 'completed' } }) }))
        act(() => mockBrowserProps.onSessionEnded('brun_1'))
        expect(String(selectedSurface() === 'browser')).toBe('true')
        act(() => mockBrowserProps.onSessionEnded('brun_2'))
        expect(String(selectedSurface() === 'alldone')).toBe('true')
    } finally {
        visible.mockRestore()
    }
})

it('keeps the expand action immediately after the assistant name and the close action at the far right', () => {
    render(content(1))
    const identity = screen.getByLabelText('Anna Alldone – Latest messages')
    const expand = screen.getByLabelText('Hide workspace — chat only')
    const close = screen.getByLabelText('Close assistant chat')
    expect(identity.nextElementSibling).toBe(expand)
    expect(expand.closest('.anna-header-left')).toBeTruthy()
    expect(close.parentElement).toBe(document.querySelector('.anna-header-right'))
    expect(close.parentElement.lastElementChild).toBe(close)

    fireEvent.click(expand)
    expect(document.querySelector('.anna-chat-only')).toBeTruthy()
    expect(identity.nextElementSibling).toBe(screen.getByLabelText('Show workspace'))
    fireEvent.click(screen.getByLabelText('Show workspace'))
    expect(document.querySelector('.anna-chat-only')).toBeNull()
    expect(identity.nextElementSibling).toBe(screen.getByLabelText('Hide workspace — chat only'))
})

it.each([
    ['desktop', 'split'],
    ['desktop', 'chat-only'],
    ['mobile', 'chat'],
    ['mobile', 'browser'],
])('closes Anna through the header X on %s from %s without losing drafts or the current page', (device, start) => {
    const originalMatchMedia = window.matchMedia
    mockMobileNavigation = device === 'mobile'
    window.matchMedia = () => ({
        matches: mockMobileNavigation,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        window.history.replaceState({}, '', '/projects/p1/notes/n1?assistant=1&filter=open#draft')
        render(content(1))
        const editor = screen.getByLabelText('Real workspace editor')
        const chat = screen.getByLabelText('Persistent conversation')
        editor.value = 'Keep my workspace draft'
        chat.value = 'Keep my unsent message'
        if (start === 'chat-only') act(() => setAnnaLayout('chat'))
        else if (start === 'browser') chooseSurface('browser')

        const close = screen.getByLabelText('Close assistant chat')
        expect(close.parentElement.lastElementChild).toBe(close)
        fireEvent.click(close)

        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(window.location.pathname).toBe('/projects/p1/notes/n1')
        expect(window.location.search).toBe('?filter=open')
        expect(window.location.hash).toBe('#draft')
        expect(screen.getByLabelText('Real workspace editor')).toBe(editor)
        expect(editor.value).toBe('Keep my workspace draft')
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()

        act(() => setAnnaMode(true))
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        expect(chat.value).toBe('Keep my unsent message')
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it('shows surface selection without manual Alldone control switches', () => {
    render(content(1))
    const toolbar = document.querySelector('.anna-header-picker')
    expect(toolbar.textContent).toContain('Alldone')
    expect(toolbar.textContent).toContain('Browser')
    expect(toolbar.textContent).not.toContain('Take control')
    expect(toolbar.textContent).not.toContain('Let Carl Code Mentor continue')
    expect(document.querySelector('.anna-shell > .anna-header')).toBeNull()
    expect(document.querySelector('.anna-conversation > .anna-header')).toBeTruthy()
    expect(document.querySelector('.anna-header').textContent).not.toContain('Looking at:')
})

it('opens running VMs without remounting the chat or workspace and keeps focus on the selected VM', async () => {
    mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'initiated' }]
    render(content(1))
    const input = screen.getByLabelText('Real workspace editor')
    input.value = 'Keep my edit'
    chooseSurface('vm:vm1')
    expect(document.querySelector('.anna-vm-surface').textContent).toContain('Live VM Launch report')
    expect(document.querySelector('.anna-workspace').getAttribute('aria-hidden')).toBe('true')
    act(() =>
        mockSnapshots['users/u1/private/annaBrowser']({
            exists: true,
            data: () => ({ runId: 'browser1', updatedAt: Date.now() }),
        })
    )
    expect(String(selectedSurface() === 'vms')).toBe('true')
    chooseSurface('alldone')
    expect(screen.getByLabelText('Real workspace editor')).toBe(input)
    expect(input.value).toBe('Keep my edit')
    expect(mockUnmounts).toBe(0)
})

it.each(['desktop', 'mobile'])('shows every VM panel and preserves selection and drafts on %s', device => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({
        matches: device === 'mobile',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    mockVmJobs = [
        { id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'initiated' },
        { id: 'vm2', projectId: 'p1', objectId: 't2', title: 'Review plan', status: 'awaiting_user' },
    ]
    try {
        const view = render(content(1))
        chooseSurface('vms')
        const panels = [...document.querySelectorAll('.anna-vm-surface')]
        expect(panels).toHaveLength(2)
        expect(panels.map(panel => panel.getAttribute('aria-label'))).toEqual(['Launch report', 'Review plan'])
        expect(document.querySelector('.anna-vms select')).toBeNull()
        expect(panels.every(panel => !panel.classList.contains('anna-surface-hidden'))).toBe(true)
        expect(panels.every(panel => panel.querySelector('[data-active]').dataset.active === 'true')).toBe(true)
        expect(mockSelectedRunId).toBe('vm1')
        const feedback = screen.getByLabelText('Feedback for Review plan')
        feedback.value = 'Keep my feedback'
        act(() => feedback.focus())
        expect(mockSelectedRunId).toBe('vm2')
        expect(document.activeElement).toBe(feedback)
        expect(mockConversationProps.pageContext).toMatchObject({ surface: 'vm', title: 'Review plan' })
        expect(panels[1].getAttribute('aria-current')).toBe('true')
        act(() => panels[0].dispatchEvent(new Event('pointerdown', { bubbles: true })))
        act(() => panels[0].focus())
        expect(mockSelectedRunId).toBe('vm2')
        act(() => panels[0].dispatchEvent(new Event('pointerup', { bubbles: true })))
        fireEvent.click(panels[0])
        expect(mockSelectedRunId).toBe('vm1')
        act(() => feedback.focus())
        mockVmJobs = mockVmJobs.map(job => (job.id === 'vm2' ? { ...job, status: 'completed' } : job))
        view.rerender(content(1))
        expect(mockSelectedRunId).toBe('vm2')
        expect(screen.getByLabelText('Review plan')).toBe(panels[1])
        chooseSurface('browser')
        expect(panels.every(panel => panel.querySelector('[data-active]').dataset.active === 'false')).toBe(true)
        chooseSurface('vms')
        expect(mockSelectedRunId).toBe('vm2')
        expect(screen.getByLabelText('Feedback for Review plan')).toBe(feedback)
        expect(feedback.value).toBe('Keep my feedback')
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it('asks discovery to keep the run the selected VM card showed, so its result survives settling (AT-2916)', () => {
    mockVmJobs = [
        { id: 'p1__t1', runId: 'run-a', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'initiated' },
        { id: 'p1__t2', runId: 'run-b', projectId: 'p1', objectId: 't2', title: 'Review plan', status: 'paused' },
    ]
    const view = render(content(1))
    chooseSurface('vm:p1__t2')
    view.rerender(content(1))
    expect(mockSelectedRunId).toBe('p1__t2')
    expect(mockSelectedCardRunId).toBe('run-b')
    // The run settled and its task was closed: the card stays, by the run it showed.
    mockVmJobs = [mockVmJobs[0]]
    view.rerender(content(1))
    expect(mockSelectedCardRunId).toBe('run-b')
    chooseSurface('vm:p1__t1')
    view.rerender(content(1))
    expect(mockSelectedCardRunId).toBe('run-a')
})

it('keeps other VM panels available if the selected session disappears, and allows retrying discovery', () => {
    mockVmJobs = [
        { id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'initiated' },
        { id: 'vm2', projectId: 'p1', objectId: 't2', title: 'Review plan', status: 'awaiting_user' },
    ]
    const view = render(content(1))
    chooseSurface('vm:vm2')
    mockVmJobs = [mockVmJobs[0]]
    view.rerender(content(1))
    expect(document.querySelector('.anna-vms [role="status"]').textContent).toBe('vm_workspace_unavailable')
    expect(screen.getByLabelText('Launch report').querySelector('[data-active]').dataset.active).toBe('true')
    mockVmError = true
    view.rerender(content(1))
    expect(document.querySelector('.anna-vms [role="alert"]')).toBeTruthy()
    fireEvent.click(screen.getByText('vm_workspace_retry'))
    expect(mockRetryVms).toHaveBeenCalledTimes(1)
    act(() => screen.getByLabelText('Launch report').focus())
    expect(mockSelectedRunId).toBe('vm1')
    expect(document.querySelector('.anna-vms [role="status"]')).toBeNull()
})

it.each(['desktop', 'mobile'])(
    'keeps interactive login in the browser pane on %s across chat navigation',
    async device => {
        const originalMatchMedia = window.matchMedia
        window.matchMedia = () => ({
            matches: device === 'mobile',
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        })
        const onFinished = jest.fn()
        const approval = { approvalId: 'login1', runId: 'brun_1', category: 'login' }
        function Request() {
            const workspace = React.useContext(AnnaBrowserTakeoverContext)
            return <button onClick={() => workspace.open(approval, { onFinished })}>Start login</button>
        }
        try {
            const view = render(
                <AnnaShell routeId={1}>
                    <Request />
                </AnnaShell>
            )
            const finishBrowsing = startBrowserActivity()
            await act(async () => screen.getByText('Start login').click())
            const login = screen.getByLabelText('Private login input')
            expect(login.closest('.anna-browser-surface')).toBeTruthy()
            expect(login.closest('.anna-conversation')).toBeNull()
            expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe('false')
            expect(mockBrowserProps.active).toBe(false)
            login.value = 'Unsent private input'
            finishBrowsing('completed')
            if (device === 'mobile') expect(selectedSurface()).toBe('browser')
            else expect(String(selectedSurface() === 'browser')).toBe('true')
            // The original request card can unmount; only the shell owns the controller.
            view.rerender(
                <AnnaShell routeId={2}>
                    <p>Another Alldone page</p>
                </AnnaShell>
            )
            await act(async () => mockConversationProps.onBeforeSend())
            expect(mockReleaseBrowser).not.toHaveBeenCalled()
            expect(screen.getByLabelText('Private login input')).toBe(login)
            expect(login.value).toBe('Unsent private input')
            expect(mockTakeoverMounts).toBe(1)
            await act(async () => mockTakeoverProps.onFinished())
            expect(onFinished).toHaveBeenCalledTimes(1)
            expect(screen.getByLabelText('Private login input')).toBeNull()
            expect(mockBrowserProps.active).toBe(true)
        } finally {
            if (originalMatchMedia) window.matchMedia = originalMatchMedia
            else delete window.matchMedia
        }
    }
)

it('passes page changes to the conversation instead of the header', async () => {
    jest.useFakeTimers()
    const originalTitle = document.title
    try {
        document.title = 'Alldone.app - Tasks'
        render(content(1))
        await act(async () => {})
        expect(mockConversationProps.pageContext).toMatchObject({ surface: 'alldone', title: 'Alldone.app - Tasks' })
        document.title = 'Alldone.app - Notes'
        await act(async () => jest.advanceTimersByTime(1000))
        expect(mockConversationProps.pageContext.title).toBe('Alldone.app - Notes')
        chooseSurface('browser')
        await act(async () =>
            mockBrowserProps.onPageChange({ title: 'Opened website', url: 'https://example.com/page' })
        )
        expect(mockConversationProps.pageContext).toMatchObject({
            surface: 'browser',
            title: 'Opened website',
            path: 'https://example.com/page',
        })
        expect(document.querySelector('.anna-header').textContent).not.toContain('Opened website')
    } finally {
        document.title = originalTitle
        jest.useRealTimers()
    }
})

it('releases the browser for a new message without an Alldone control transaction or duplicate continuation', async () => {
    render(content(1))
    await act(async () =>
        screen.getByLabelText('Real workspace editor').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    )
    act(() => mockBrowserProps.onControlChange(true))
    await act(async () => mockConversationProps.onBeforeSend())
    expect(mockRunTransaction).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockReleaseBrowser).toHaveBeenCalledTimes(1)
    expect(mockConversationProps.resumeRequest).toBeNull()
    expect(screen.getByText('Take control')).toBeUndefined()
})

it('ignores persisted Alldone control and does not need a hand-back write to send', async () => {
    mockTransactionState = { control: 'user', blocked: { objectId: 'paused-task' } }
    mockRunTransaction.mockRejectedValue(new Error('Workspace state unavailable'))
    render(content(1))
    await act(async () => mockConversationProps.onBeforeSend())
    expect(mockSnapshots['users/u1/private/annaWorkspace']).toBeUndefined()
    expect(mockRunTransaction).not.toHaveBeenCalled()
    expect(mockReleaseBrowser).toHaveBeenCalledTimes(1)
})

it('still respects a failed browser hand-back', async () => {
    render(content(1))
    act(() => mockBrowserProps.onControlChange(true))
    mockReleaseBrowser.mockRejectedValueOnce(new Error('Browser unavailable'))
    await act(async () => {
        await expect(mockConversationProps.onBeforeSend()).rejects.toThrow('Browser unavailable')
    })
    expect(mockReleaseBrowser).toHaveBeenCalledTimes(1)
    expect(mockRunTransaction).not.toHaveBeenCalled()
})

it('keeps the conversation mounted across workspace navigation with its topic and voice state', async () => {
    const view = render(content(1))
    fireEvent.change(screen.getByLabelText('Persistent conversation'), { target: { value: 'Unsent message' } })
    view.rerender(content(2))
    expect(screen.getByLabelText('Persistent conversation').value).toBe('Unsent message')
    expect(mockUnmounts).toBe(0)
    expect(mockConversationProps.conversation).toMatchObject({ id: 'anna_u1', projectId: 'p1' })
    expect(mockConversationProps.call.status).toBe('idle')
    await act(async () => {})
})

it('preserves both editors when zooming out and back without remounting the workspace', async () => {
    const view = render(content(1))
    const workspace = screen.getByLabelText('Real workspace editor')
    const chat = screen.getByLabelText('Persistent conversation')
    workspace.value = 'Work in progress'
    chat.value = 'Unsent message'
    closeAssistant()
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    act(() => setAnnaMode(true))
    expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
    expect(workspace.value).toBe('Work in progress')
    expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
    expect(chat.value).toBe('Unsent message')
    expect(mockUnmounts).toBe(0)
    await act(async () => {})
})

it('holds assistant navigation during browser control until Open is clicked', async () => {
    const view = render(content(1))
    view.rerender(content(2))
    act(() => mockBrowserProps.onControlChange(true))
    useAnnaConversation.mockReturnValue({
        ...state,
        conversation: {
            ...conversation,
            annaPresentation: { id: 'request1', view: 'notes', path: '/projects/notes/all', title: 'Notes' },
        },
    })
    view.rerender(content(2))
    expect(URLTrigger.processUrl).not.toHaveBeenCalled()
    expect(document.querySelector('.anna-pending')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Open', { exact: true })))
    expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, '/projects/notes/all')
    expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
            annaPresentationStatus: expect.objectContaining({ id: 'request1', status: 'opened' }),
        })
    )
})

it.each([false, true])('keeps the logo navigation separate from the chat toggle when chat is %s', active => {
    render(content(1, true))
    if (!active) closeAssistant()
    const logo = screen.getByLabelText('Alldone.app')
    const toggle = assistantToggle()
    expect(logo.parentElement).toBe(toggle.parentElement)
    expect(logo.contains(toggle)).toBe(false)
    expect(logo.parentElement.textContent).not.toContain('Anna Alldone')

    mockDispatch.mockClear()
    NavigationService.navigate.mockClear()
    scrollView.current.scrollTo.mockClear()
    fireEvent.click(logo)

    expect(toggle.getAttribute('aria-expanded')).toBe(String(active))
    expect(scrollView.current.scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: true })
    expect(NavigationService.navigate).toHaveBeenCalledWith('Root')
    expect(mockDispatch).toHaveBeenCalledWith([
        { type: 'SEARCH_TEXT', text: '' },
        { type: 'SEARCH_RESULTS', results: null },
        { type: 'HIDE_SEARCH' },
        { type: 'RESET_NOTES_AMOUNTS' },
        { type: 'ALL_PROJECTS_TASKS', options: undefined },
    ])
})

it.each([false, true])(
    'keeps the sidebar panel avatar-free and its label in sync with the selected assistant when chat is %s',
    active => {
        mockDefaultAssistant = { ...mockDefaultAssistant, photoURL50: 'anna.png' }
        const view = render(content(1, true))
        if (!active) closeAssistant()
        expect(assistantToggle().querySelector('img')).toBeNull()

        mockDefaultAssistant = { uid: 'mira', displayName: 'Mira', photoURL300: 'mira.png' }
        view.rerender(content(1, true))

        expect(assistantToggle().getAttribute('aria-expanded')).toBe(String(active))
        expect(assistantToggle().getAttribute('aria-label')).toBe(
            `Mira: ${active ? 'Close assistant chat' : 'Open assistant chat'}`
        )
        expect(assistantToggle().querySelector('img')).toBeNull()
    }
)

it.each([
    ['mobile', 'alldone'],
    ['mobile', 'workspace'],
    ['mobile', 'chat'],
    ['mobile', 'chat-only'],
    ['desktop', 'alldone'],
    ['desktop', 'workspace'],
    ['desktop', 'chat'],
    ['desktop', 'chat-only'],
    ['desktop', 'browser'],
    ['desktop', 'vm:vm1'],
])('toggles the chat and opens Home from the default assistant sidebar button on %s from %s', (device, start) => {
    const originalMatchMedia = window.matchMedia
    mockMobileNavigation = device === 'mobile'
    window.matchMedia = () => ({
        matches: mockMobileNavigation,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
        render(content(1, true))
        const chat = screen.getByLabelText('Persistent conversation')
        chat.value = 'Keep my chat draft'
        if (start === 'alldone') closeAssistant()
        else if (start === 'workspace') showAlldoneWorkspace()
        else if (start === 'chat-only') act(() => setAnnaLayout('chat'))
        else if (start === 'browser' || start.startsWith('vm:')) chooseSurface(start)
        // Setup may leave through the Home button, which navigates on its own (AT-2920).
        NavigationService.navigate.mockClear()

        for (const opens of [start === 'alldone', start !== 'alldone']) {
            fireEvent.click(assistantToggle())
            expect(assistantToggle().getAttribute('aria-expanded')).toBe(String(opens))
            expect(assistantToggle().getAttribute('aria-label')).toBe(
                `Anna Alldone: ${opens ? 'Close assistant chat' : 'Open assistant chat'}`
            )
            expect(assistantToggle().querySelector('svg path:last-child').getAttribute('d')).toBe(
                opens ? 'm13 8 4 4-4 4' : 'm16 8-4 4 4 4'
            )
            if (opens) {
                expect(screen.getByLabelText('Close assistant chat').closest('.anna-header-right')).toBeTruthy()
                expect(document.querySelector('.anna-header-left').firstElementChild).toBe(
                    screen.getByLabelText('Anna Alldone – Latest messages')
                )
            }
            expect(screen.getByLabelText('Conversation with Carl Code Mentor').getAttribute('aria-hidden')).toBe(
                String(!opens)
            )
            expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe(
                String(opens && device === 'mobile')
            )
            if (opens) {
                expect(document.querySelector('.anna-zoom-active.anna-mobile-chat')).toBeTruthy()
                expect(document.activeElement).toBe(chat)
                if (device === 'desktop') expect(selectedSurface()).toBe('alldone')
            } else expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
            expect(mockDispatch).toHaveBeenLastCalledWith([
                { type: 'HIDE_FLOAT_POPUP' },
                { type: 'HIDE_SEARCH' },
                { type: 'SEARCH_RESULTS', results: null },
                { type: 'ALL_PROJECTS_TASKS', options: { taskViewToggleSection: 'Open', taskViewToggleIndex: 0 } },
            ])
            expect(NavigationService.navigate).toHaveBeenLastCalledWith('Root')
        }
        expect(NavigationService.navigate).toHaveBeenCalledTimes(2)
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        expect(chat.value).toBe('Keep my chat draft')
        expect(mockUnmounts).toBe(0)
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        if (device === 'mobile') expect(mockDispatch).toHaveBeenCalledWith({ type: 'HIDE_SIDEBAR' })
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it.each([
    ['desktop', 'fullscreen'],
    ['desktop', 'alldone'],
    ['desktop', 'chat-only'],
    ['mobile', 'workspace'],
    ['mobile', 'chat'],
    ['mobile', 'chat-only'],
])('shows the selected sidebar project while keeping the chat open on %s from %s', (device, start) => {
    const originalMatchMedia = window.matchMedia
    mockMobileNavigation = device === 'mobile'
    window.matchMedia = () => ({
        matches: mockMobileNavigation,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        render(
            <AnnaShell routeId="project-navigation">
                <WorkspaceNavigationFixture />
                {sidebarHeader()}
                <ProjectItem
                    itemIndex={0}
                    projectData={{ id: 'p2', index: 1, name: 'Familie', color: '#39CCCC' }}
                    projectType="active"
                />
            </AnnaShell>
        )
        const chat = screen.getByLabelText('Persistent conversation')
        chat.value = 'Keep my chat draft'
        if (start === 'fullscreen') closeAssistant()
        else if (start === 'workspace') showAlldoneWorkspace()
        else if (start === 'chat-only') act(() => setAnnaLayout('chat'))

        fireEvent.click(screen.getByText('Familie'))
        expect(assistantToggle().getAttribute('aria-expanded')).toBe(String(start !== 'fullscreen'))
        expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe('false')
        expect(document.querySelector('.anna-header-picker select').value).toBe('alldone')
        expect(mockDispatch).toHaveBeenLastCalledWith(expect.arrayContaining([{ type: 'PROJECT', index: 1 }]))
        if (device === 'mobile') {
            expect(document.querySelector('.anna-mobile-workspace')).toBeTruthy()
            expect(mockDispatch).toHaveBeenLastCalledWith(expect.arrayContaining([{ type: 'HIDE_SIDEBAR' }]))
        }
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        expect(chat.value).toBe('Keep my chat draft')
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it.each(['chat', 'browser', 'vms', 'vm:vm1'])(
    'returns from mobile %s to the same Alldone page with retained drafts',
    surface => {
        const originalMatchMedia = window.matchMedia
        window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
        if (surface === 'vm:vm1')
            mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
        try {
            window.history.replaceState({}, '', '/projects/p1/tasks/t1/chat?assistant=1&filter=open#draft')
            render(content(1))
            const editor = screen.getByLabelText('Real workspace editor')
            editor.value = 'My unsaved workspace edit'
            const chat = screen.getByLabelText('Persistent conversation')
            chat.value = 'My unsent chat message'
            if (surface !== 'chat') chooseSurface(surface)
            expect(document.querySelectorAll('.anna-header')).toHaveLength(1)
            expect(document.querySelector('.anna-header').closest('.anna-conversation')).toBeNull()
            expect(document.querySelector('.anna-workspace-switcher')).toBeNull()
            expect(document.querySelector('.anna-header-expand')).toBeNull()
            chooseSurface('alldone')
            expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
            expect(document.querySelector('.anna-header')).toBeNull()
            expect(window.location.pathname).toBe('/projects/p1/tasks/t1/chat')
            expect(window.location.search).toBe('?filter=open')
            expect(window.location.hash).toBe('#draft')
            expect(URLTrigger.processUrl).not.toHaveBeenCalled()
            expect(document.activeElement).toBe(screen.getByLabelText('Alldone workspace'))
            expect(screen.getByLabelText('Real workspace editor')).toBe(editor)
            expect(editor.value).toBe('My unsaved workspace edit')
            act(() => setAnnaMode(true))
            expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
            expect(chat.value).toBe('My unsent chat message')
            expect(mockUnmounts).toBe(0)
        } finally {
            if (originalMatchMedia) window.matchMedia = originalMatchMedia
            else delete window.matchMedia
        }
    }
)

it('keeps the desktop split layout when selecting Alldone from another surface', () => {
    render(content(1))
    chooseSurface('browser')
    chooseSurface('alldone')
    expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
    expect(document.querySelector('.anna-header').closest('.anna-conversation')).toBeTruthy()
    expect(window.location.search).toContain('assistant=1')
    expect(screen.getByLabelText('Conversation with Carl Code Mentor').getAttribute('aria-hidden')).toBe('false')
    expect(selectedSurface()).toBe('alldone')
})

it('switches mobile browser, VM and chat through the top dropdown without losing drafts', () => {
    const originalMatchMedia = window.matchMedia
    const visible = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    mockVmJobs = [
        { id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' },
        { id: 'vm2', projectId: 'p1', objectId: 't2', title: 'Review plan', status: 'awaiting_user' },
    ]
    try {
        render(content(1))
        const selector = document.querySelector('.anna-header-picker select')
        const chat = screen.getByLabelText('Persistent conversation')
        chat.value = 'My unsent chat message'
        showAlldoneWorkspace()
        const finishBrowser = startBrowserActivity()
        expect(selector.value).toBe('browser')
        finishBrowser('completed')
        expect(selector.value).toBe('alldone')
        expect(document.querySelector('.anna-fullscreen')).toBeNull()
        const finishNext = startBrowserActivity('answer2', 'brun_2')
        chooseSurface('vm:vm2')
        finishNext('completed')
        expect(selector.value).toBe('vms')
        expect(screen.getByLabelText('Review plan').getAttribute('aria-current')).toBe('true')
        expect(
            [...document.querySelectorAll('.anna-vm-surface [data-active]')].every(
                node => node.dataset.active === 'true'
            )
        ).toBe(true)
        showChat()
        expect(document.activeElement).toBe(chat)
        expect(chat.closest('section').getAttribute('aria-hidden')).toBe('false')
        expect(screen.getByLabelText('Alldone workspace').hasAttribute('inert')).toBe(true)
        chooseSurface('vms')
        expect(screen.getByLabelText('Review plan').getAttribute('aria-current')).toBe('true')
        chooseSurface('browser')
        expect(selector.value).toBe('browser')
        expect(document.activeElement).toBe(screen.getByLabelText('Alldone workspace'))
        expect(chat.closest('section').hasAttribute('inert')).toBe(true)
        expect([...selector.options].map(option => option.textContent)).toEqual([
            'Back to chat',
            'Alldone',
            'Browser',
            'VMs (2)',
        ])
        expect(document.querySelectorAll('.anna-header')).toHaveLength(1)
        expect(document.querySelector('.anna-workspace-switcher')).toBeNull()
        showChat()
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        expect(chat.value).toBe('My unsent chat message')
        expect(mockUnmounts).toBe(0)
    } finally {
        visible.mockRestore()
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it('resumes a returned browser while the user is editing Alldone', async () => {
    render(content(1))
    await act(async () =>
        screen.getByLabelText('Real workspace editor').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    )
    act(() => {
        mockBrowserProps.onControlChange(true)
        mockBrowserProps.onResume(
            { projectId: 'p1', objectId: 'anna_u1', objectType: 'topics', assistantId: 'a1', at: 123 },
            'browser'
        )
    })
    expect(mockConversationProps.resumeRequest).toBeNull()
    act(() => mockBrowserProps.onControlChange(false))
    expect(mockConversationProps.resumeRequest).toMatchObject({
        surface: 'browser',
        text: 'I have returned browser control to you. Please continue my current request.',
    })
    expect(screen.getByText('Let Carl Code Mentor continue')).toBeUndefined()
})

it.each(['pointerdown', 'keydown', 'wheel'])(
    'keeps assistant presentations and chat available after workspace %s',
    async eventName => {
        const view = render(content(1))
        const input = screen.getByLabelText('Real workspace editor')
        input.value = 'My unsaved edit'
        await act(async () => input.dispatchEvent(new Event(eventName, { bubbles: true })))
        useAnnaConversation.mockReturnValue({
            ...state,
            conversation: {
                ...conversation,
                annaPresentation: {
                    id: 'new-task',
                    view: 'task',
                    path: '/projects/p1/tasks/t1/properties',
                    createdAt: Date.now(),
                },
            },
        })
        view.rerender(content(1))
        await act(async () => {})
        expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, '/projects/p1/tasks/t1/properties')
        await act(async () => mockConversationProps.onBeforeSend())
        expect(mockSet).not.toHaveBeenCalled()
        expect(mockRunTransaction).not.toHaveBeenCalled()
        expect(input.value).toBe('My unsaved edit')
        expect(mockConversationProps.resumeRequest).toBeNull()
    }
)

it('does not pause the assistant for passive viewing or pointer movement', async () => {
    render(content(1))
    await act(async () =>
        screen.getByLabelText('Real workspace editor').dispatchEvent(new Event('pointermove', { bubbles: true }))
    )
    expect(mockRunTransaction).not.toHaveBeenCalled()
})

it('does not create a conversation until the user first opens the assistant view', async () => {
    setAnnaMode(false)
    render(content(1))
    expect(useAnnaConversation.mock.calls.at(-1)[1].enabled).toBe(false)
    expect(screen.getByLabelText('Persistent conversation')).toBeNull()
    act(() => setAnnaMode(true))
    expect(useAnnaConversation.mock.calls.at(-1)[1].enabled).toBe(true)
    expect(screen.getByLabelText('Persistent conversation')).toBeTruthy()
    await act(async () => {})
})

it.each([
    ['desktop', 'split'],
    ['desktop', 'chat'],
    ['desktop', 'alldone'],
    ['mobile', 'split'],
    ['mobile', 'chat'],
    ['mobile', 'alldone'],
])('restores the selected %s %s layout before mounting a new app instance', async (device, layout) => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({
        matches: device === 'mobile',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        render(content(1))
        if (layout === 'chat') {
            if (device === 'desktop') fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
            // Chat-only links can also be opened on mobile, which shows one pane at a time.
            else act(() => setAnnaLayout('chat'))
        }
        if (layout === 'alldone') closeAssistant()
        expect(window.localStorage.getItem('anna-mobile-layout:v1')).toBe(layout)

        act(() => testRoot.unmount())
        testRoot = null
        testContainer.remove()
        // The installed PWA starts from its manifest URL, without a layout query.
        window.history.replaceState(null, '', '/?utm_source=web_app_manifest')
        restoreAnnaLayout()
        mockConversationProps = null
        render(content(1))
        await act(async () => {})

        expect(document.querySelector('.anna-fullscreen') !== null).toBe(layout === 'alldone')
        expect(document.querySelector('.anna-chat-only') !== null).toBe(layout === 'chat')
        expect(useAnnaConversation.mock.calls.at(-1)[1].enabled).toBe(layout !== 'alldone')
        expect(mockConversationProps?.visible ?? false).toBe(layout !== 'alldone')
        expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe(
            String(layout !== 'alldone' && (layout === 'chat' || device === 'mobile'))
        )
        expect(window.localStorage.getItem('anna-mobile-layout:v1')).toBe(layout)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it('keeps conversation attribution tied to its assistant when the project default is different', async () => {
    const view = render(content(1))
    expect(mockConversationProps.assistant.displayName).toBe('Carl Code Mentor')
    expect(screen.getByLabelText('Conversation with Carl Code Mentor')).toBeTruthy()
    expect(screen.getByText('Anna Alldone')).toBeTruthy()

    mockAssistant = { ...mockAssistant, displayName: 'Mira' }
    view.rerender(content(1))
    expect(mockConversationProps.assistant.displayName).toBe('Mira')
    expect(screen.getByLabelText('Conversation with Mira')).toBeTruthy()
    expect(screen.getByText('Anna Alldone')).toBeTruthy()
    await act(async () => {})
})

it('updates the header name and photo from the current default-project assistant despite an older conversation', () => {
    const view = render(content(1))
    expect(screen.getByLabelText('Anna Alldone – Latest messages')).toBeTruthy()
    mockDefaultAssistant = { uid: 'mira', displayName: 'Mira', photoURL50: 'mira.png' }
    view.rerender(content(1))
    expect(screen.getByLabelText('Mira – Latest messages')).toBeTruthy()
    expect(document.querySelector('.anna-small-avatar img').getAttribute('src')).toBe('mira.png')
    expect(screen.getByLabelText('Anna Alldone – Latest messages')).toBeNull()
    expect(mockConversationProps.assistant.uid).toBe('a1')
    mockDefaultAssistant = { ...mockDefaultAssistant, displayName: 'Mira Coach', photoURL50: 'mira-new.png' }
    view.rerender(content(1))
    expect(screen.getByLabelText('Mira Coach – Latest messages')).toBeTruthy()
    expect(document.querySelector('.anna-small-avatar img').getAttribute('src')).toBe('mira-new.png')
})

it('opens assistant mode from the app header avatar and keeps the workspace editor mounted', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    try {
        render(
            <AnnaShell routeId="avatar-entry">
                <AssistantModeButton />
                <input aria-label="Workspace draft" defaultValue="Unsaved note" />
            </AnnaShell>
        )
        const draft = screen.getByLabelText('Workspace draft')
        closeAssistant()
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        fireEvent.click(screen.getByLabelText('Anna Alldone: Open assistant chat'))
        expect(document.querySelector('.anna-zoom-active.anna-mobile-chat')).toBeTruthy()
        expect(mockConversationProps.visible).toBe(true)
        expect(screen.getByLabelText('Workspace draft')).toBe(draft)
        expect(draft.value).toBe('Unsaved note')
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it.each(['chat', 'workspace', 'closed'])(
    'waits for the first conversation input without stealing focus from %s',
    destination => {
        setAnnaMode(false)
        useAnnaConversation.mockReturnValue({ ...state, conversation: null, loading: true })
        const view = render(content(1))
        fireEvent.click(screen.getByLabelText('Anna Alldone: Open assistant chat'))
        expect(document.activeElement).toBe(document.querySelector('.anna-conversation'))

        if (destination === 'workspace') act(() => screen.getByLabelText('Real workspace editor').focus())
        else if (destination === 'closed') closeAssistant()

        useAnnaConversation.mockReturnValue(state)
        view.rerender(content(1))

        const target =
            destination === 'chat'
                ? 'Persistent conversation'
                : destination === 'workspace'
                  ? 'Real workspace editor'
                  : 'Alldone workspace'
        expect(document.activeElement).toBe(screen.getByLabelText(target))
    }
)

it('shows the live task total on the separate task button, including zero', () => {
    mockSidebarNumbers = { p1: { u1: 20 }, p2: { u1: 7, someoneElse: 90 } }
    const view = render(content(1))
    act(() => setAnnaLayout('chat'))
    expect(screen.getByLabelText('27 open tasks today').querySelector('.anna-open-tasks-badge').textContent).toBe('27')
    expect(document.querySelector('.anna-header-assistant').textContent).not.toContain('27')
    mockSidebarNumbers = { p1: { u1: 0 } }
    view.rerender(content(1))
    expect(screen.getByLabelText('0 open tasks today').querySelector('.anna-open-tasks-badge').textContent).toBe('0')
})

it('hides the duplicated task count in the desktop sidebar and closes it from Alldone', () => {
    render(content(1))
    const workspace = screen.getByLabelText('Real workspace editor')
    workspace.value = 'Keep my edit'
    expect(document.querySelector('.anna-header-tasks')).toBeNull()
    expect(document.querySelector('.anna-header-sidebar')).toBeTruthy()
    expect(screen.getByLabelText('Anna Alldone: Close assistant chat')).toBeTruthy()
    closeAssistant()
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
    expect(workspace.value).toBe('Keep my edit')
    fireEvent.click(screen.getByLabelText('Anna Alldone: Open assistant chat'))
    expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
    expect(document.querySelector('.anna-header-tasks')).toBeNull()
    expect(screen.getByLabelText('Anna Alldone: Close assistant chat')).toBeTruthy()
    expect(mockUnmounts).toBe(0)
})

it.each([
    ['desktop', 'alldone'],
    ['desktop', 'browser'],
    ['desktop', 'vms'],
    ['desktop', 'vm:vm1'],
    ['desktop', 'chat-only'],
    ['mobile', 'chat'],
    ['mobile', 'workspace'],
    ['mobile', 'browser'],
    ['mobile', 'vms'],
    ['mobile', 'chat-only'],
])('returns to the chat and its latest message on %s from %s', (device, start) => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({
        matches: device === 'mobile',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        if (start === 'vm:vm1') {
            mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
        }
        render(content(1))
        if (start === 'browser' || start === 'vms' || start.startsWith('vm:')) chooseSurface(start)
        else if (start === 'workspace') showAlldoneWorkspace()
        else if (start === 'chat-only') act(() => setAnnaLayout('chat'))
        const shell = document.querySelector('.anna-shell')
        const surface = selectedSurface()
        const picker = document.querySelector('.anna-header-picker select')
        const surfaceLabel = picker.selectedOptions[0].textContent
        const path = window.location.href
        const chat = screen.getByLabelText('Persistent conversation')
        const workspace = screen.getByLabelText('Real workspace editor')
        chat.value = 'Keep my draft'
        workspace.value = 'Keep my edit'
        fireEvent.click(screen.getByLabelText('Anna Alldone – Latest messages'))
        expect(mockScrollToLatest).toHaveBeenCalledTimes(1)
        expect(shell.classList.contains('anna-mobile-chat')).toBe(true)
        expect(mockConversationProps.visible).toBe(true)
        expect(document.activeElement).toBe(chat)
        expect(shell.classList.contains('anna-chat-only')).toBe(start === 'chat-only')
        const restoresAlldone = device === 'desktop' && start !== 'chat-only'
        expect(selectedSurface()).toBe(device === 'mobile' ? '' : restoresAlldone ? 'alldone' : surface)
        expect(picker.selectedOptions[0].textContent).toBe(restoresAlldone ? 'Alldone' : surfaceLabel)
        if (restoresAlldone) {
            expect(document.querySelector('.anna-workspace').getAttribute('aria-hidden')).toBe('false')
            expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe('false')
        }
        expect(window.location.href).toBe(path)
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        expect(chat.value).toBe('Keep my draft')
        expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
        expect(workspace.value).toBe('Keep my edit')
        expect(mockUnmounts).toBe(0)
        fireEvent.click(screen.getByLabelText('Anna Alldone – Latest messages'))
        expect(mockScrollToLatest).toHaveBeenCalledTimes(2)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it.each(['browser', 'vm:vm1'])('keeps the hidden %s workspace when returning to the latest messages', surface => {
    mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
    render(content(1))
    chooseSurface(surface)
    fireEvent.click(screen.getByLabelText('Hide workspace — chat only'))
    fireEvent.click(screen.getByLabelText('Anna Alldone – Latest messages'))
    expect(document.querySelector('.anna-chat-only')).toBeTruthy()
    expect(selectedSurface()).toBe(surface.startsWith('vm:') ? 'vms' : surface)
    expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe('true')
    expect(mockScrollToLatest).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByLabelText('Persistent conversation'))
    showWorkspace()
    expect(selectedSurface()).toBe(surface.startsWith('vm:') ? 'vms' : surface)
})

it.each(['desktop', 'mobile'])('opens the app view from the header controls on %s', device => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({
        matches: device === 'mobile',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        render(content(1))
        chooseSurface('browser')
        const workspace = screen.getByLabelText('Real workspace editor')
        const chat = screen.getByLabelText('Persistent conversation')
        workspace.value = 'Keep my note'
        const path = window.location.href
        closeAssistant()
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe('false')
        expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
        expect(workspace.value).toBe('Keep my note')
        expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
        const workspaceUrl = new URL(path)
        workspaceUrl.searchParams.delete('assistant')
        expect(window.location.href).toBe(workspaceUrl.href)
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

const HOME_NAVIGATION = [
    { type: 'PROJECT', index: -1 },
    { type: 'SIDEBAR_TAB', tab: 'ROOT_TASKS' },
    { type: 'ALL_PROJECTS_TASKS', options: { taskViewToggleSection: 'Open', taskViewToggleIndex: 0 } },
]

it.each(['chat-only', 'mobile'])('opens the open task list from the Home button (%s, AT-2920)', layout => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = () => ({
        matches: layout === 'mobile',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        if (layout === 'chat-only') setAnnaLayout('chat')
        render(content(1))
        const workspace = screen.getByLabelText('Real workspace editor')
        workspace.value = 'Keep my note'
        mockDispatch.mockClear()
        NavigationService.navigate.mockClear()
        const home = document.querySelector('.anna-header-tasks')
        expect(home).toBeTruthy()
        fireEvent.click(home)
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(mockDispatch).toHaveBeenCalledWith(HOME_NAVIGATION)
        expect(NavigationService.navigate).toHaveBeenCalledWith('Root')
        // Leaving the assistant must not cost the workspace its editors.
        expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
        expect(workspace.value).toBe('Keep my note')
        expect(mockUnmounts).toBe(0)
    } finally {
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    }
})

it('keeps the current Alldone page when the chat is closed with the X (AT-2920)', () => {
    setAnnaLayout('chat')
    render(content(1))
    mockDispatch.mockClear()
    NavigationService.navigate.mockClear()
    fireEvent.click(screen.getByLabelText('Close assistant chat'))
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    expect(mockDispatch).not.toHaveBeenCalledWith(HOME_NAVIGATION)
    expect(NavigationService.navigate).not.toHaveBeenCalledWith('Root')
})

it.each(['updates', 'chats'])('opens linked %s activity from chat-only mode inside Alldone', async feature => {
    setAnnaLayout('chat')
    const path = `/projects/p1/user/u1/${feature}/followed`
    render(
        <AnnaShell>
            <a href={path}>Activity</a>
        </AnnaShell>
    )
    await act(async () => testContainer.querySelector('a').click())
    expect(URLTrigger.processUrl).toHaveBeenLastCalledWith({}, path)
    expect(document.querySelector('.anna-chat-only')).toBeNull()
    expect(document.querySelector('.anna-shell').classList.contains('anna-mobile-workspace')).toBe(true)
})

describe('selected project (AT-2903)', () => {
    const cto = { uid: 'cto', displayName: 'Alldone CTO', photoURL50: 'cto.png' }
    beforeEach(() => {
        Object.assign(mockUser, { defaultProjectId: 'p1', projectIds: ['p1', 'p2'] })
        mockProjectsMap = {
            p1: { id: 'p1', name: 'Home', userIds: ['u1'] },
            p2: { id: 'p2', name: 'Alldone Product', userIds: ['u1', 'teammate'], assistantId: 'cto' },
        }
        mockExtraAssistants = { p2: [cto] }
    })
    afterEach(() => {
        delete mockUser.defaultProjectId
        delete mockUser.projectIds
    })
    const switcher = () => mockConversationProps.renderProjectSwitcher({ disabled: false })

    it('offers the projects in the composer and continues the chat in the chosen one', () => {
        const view = render(content(1))
        expect(useAnnaConversation).toHaveBeenLastCalledWith('u1', expect.objectContaining({ projectId: 'p1' }))
        // AT-3024: the chip starts on "Automatic", which continues the default project's chat.
        expect(switcher().props).toMatchObject({ activeProjectId: ':automatic', busy: undefined })
        expect(switcher().props.choices.map(choice => [choice.id, choice.assistant?.uid])).toEqual([
            [':automatic', 'anna'],
            ['p1', 'anna'],
            ['p2', 'cto'],
        ])
        act(() => switcher().props.onSelect('p2'))
        expect(useAnnaConversation).toHaveBeenLastCalledWith('u1', expect.objectContaining({ projectId: 'p2' }))
        // While the project chat resolves, the header previews the project's assistant.
        useAnnaConversation.mockReturnValue({ ...state, activeProjectId: 'p2', switching: true })
        view.rerender(content(1))
        expect(screen.getByLabelText('Alldone CTO – Latest messages')).toBeTruthy()
        expect(document.querySelector('.anna-small-avatar img').getAttribute('src')).toBe('cto.png')
        expect(mockConversationProps).toMatchObject({ switching: true, assistant: cto })
        expect(switcher().props).toMatchObject({ activeProjectId: 'p2', busy: true })
    })

    it('hands the chosen project to the chat history, but not a re-selection of the current one (AT-2914)', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(4242)
        const view = render(content(1))
        act(() => switcher().props.onSelect('p1'))
        expect(mockConversationProps.projectSwitch).toBeNull()
        act(() => switcher().props.onSelect('p2'))
        expect(mockConversationProps.projectSwitch).toEqual({
            id: 1,
            projectId: 'p2',
            name: 'Alldone Product',
            created: 4242,
        })
        useAnnaConversation.mockReturnValue({ ...state, activeProjectId: 'p2' })
        view.rerender(content(1))
        act(() => switcher().props.onSelect(null))
        expect(mockConversationProps.projectSwitch).toMatchObject({ id: 2, projectId: 'p1', name: 'Home' })
        now.mockRestore()
    })

    it('keeps the default chat when switching between Automatic and the default project (AT-3024)', () => {
        useAnnaConversation.mockReturnValue({ ...state, activeProjectId: 'p1' })
        render(content(1))
        expect(switcher().props.activeProjectId).toBe(':automatic')
        act(() => switcher().props.onSelect('p1'))
        expect(switcher().props.activeProjectId).toBe('p1')
        expect(mockConversationProps.projectSwitch).toBeNull()
        act(() => switcher().props.onSelect(':automatic'))
        expect(switcher().props.activeProjectId).toBe(':automatic')
        expect(useAnnaConversation).toHaveBeenLastCalledWith('u1', expect.objectContaining({ projectId: 'p1' }))
        expect(mockConversationProps.projectSwitch).toBeNull()
    })

    it('returns to the default project with a notice when the chosen project is refused', () => {
        render(content(1))
        act(() => switcher().props.onSelect('p2'))
        const { onProjectUnavailable } = useAnnaConversation.mock.calls.at(-1)[1]
        act(() => onProjectUnavailable('p2', 'You are no longer a member of this project.'))
        expect(useAnnaConversation).toHaveBeenLastCalledWith('u1', expect.objectContaining({ projectId: 'p1' }))
        expect(document.querySelector('.anna-error[role="alert"]').textContent).toContain(
            'You are no longer a member of this project. Continuing in your default project.'
        )
    })

    it('cannot switch project during a voice call', () => {
        render(content(1))
        expect(switcher().props.disabled).toBe(false)
        expect(mockConversationProps.renderProjectSwitcher({ disabled: true }).props.disabled).toBe(true)
    })

    // AT-3034: assistant mode is entered from the assistant line, which hands over its project so
    // the sidebar continues with the assistant the line showed.
    const lineShell = projectId => (
        <AnnaShell routeId={1}>
            <AssistantModeButton
                inline
                testID="assistant-line-assistant-mode"
                projectId={projectId}
                assistantName="Line assistant"
            />
        </AnnaShell>
    )
    const lastProject = () => useAnnaConversation.mock.calls.at(-1)[1].projectId

    it("opens assistant mode on the assistant line's project (AT-3034)", () => {
        setAnnaMode(false)
        render(lineShell('p2'))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        fireEvent.click(screen.getByLabelText('Line assistant: Open assistant chat'))
        expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
        expect(lastProject()).toBe('p2')
        expect(switcher().props.activeProjectId).not.toBe(':automatic')
        // The sidebar now shows this line, so the same button closes it.
        fireEvent.click(screen.getByLabelText('Line assistant: Close assistant chat'))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    })

    it('moves an open sidebar back to "Automatic" from the All projects line (AT-3034)', () => {
        setAnnaMode(true)
        render(lineShell(null))
        act(() => switcher().props.onSelect('p2'))
        expect(lastProject()).toBe('p2')
        fireEvent.click(screen.getByLabelText('Line assistant: Open assistant chat'))
        expect(lastProject()).toBe('p1')
        expect(switcher().props.activeProjectId).toBe(':automatic')
        expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
    })

    it('keeps an explicitly chosen default project when the All projects line opens it (AT-3034)', () => {
        setAnnaMode(true)
        render(lineShell(null))
        act(() => switcher().props.onSelect('p1'))
        // The sidebar already continues the default chat, so this line's button closes it ...
        fireEvent.click(screen.getByLabelText('Line assistant: Close assistant chat'))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        // ... and reopening it keeps the explicit pick.
        fireEvent.click(screen.getByLabelText('Line assistant: Open assistant chat'))
        expect(lastProject()).toBe('p1')
        expect(switcher().props.activeProjectId).not.toBe(':automatic')
    })

    it('opens without switching when the line project cannot hold the chat (AT-3034)', () => {
        setAnnaMode(false)
        mockUser.archivedProjectIds = ['p2']
        try {
            render(lineShell('p2'))
            fireEvent.click(screen.getByLabelText('Line assistant: Open assistant chat'))
            expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
            expect(lastProject()).toBe('p1')
        } finally {
            delete mockUser.archivedProjectIds
        }
    })

    it('lets the sidebar pick another assistant at its top left (AT-3034)', () => {
        setAnnaMode(true)
        render(content(1))
        const picker = document.querySelector('.anna-header-left .anna-assistant-picker')
        expect(picker.getAttribute('aria-label')).toBe('Assistant: Anna Alldone')
        fireEvent.click(picker)
        const rows = [...document.querySelectorAll('.anna-project-option')]
        expect(rows.map(row => row.querySelector('.anna-project-option-text').textContent)).toEqual([
            'Anna AlldoneAutomatic project description',
            'Alldone CTOAlldone Product · Visible to project members',
        ])
        fireEvent.click(rows[1])
        expect(lastProject()).toBe('p2')
        // The composer's project chip follows the same choice.
        expect(switcher().props.activeProjectId).not.toBe(':automatic')
    })
})

// AT-3036: a project chosen in the chat moves the Alldone workspace on the right to that project.
describe('the workspace follows the chat’s project (AT-3036)', () => {
    const cto = { uid: 'cto', displayName: 'Alldone CTO', photoURL50: 'cto.png' }
    const projects = [
        { id: 'p1', index: 0, name: 'Home', userIds: ['u1'] },
        { id: 'p2', index: 1, name: 'Alldone Product', userIds: ['u1'], assistantId: 'cto' },
        { id: 'p3', index: 2, name: 'Steercom', userIds: ['u1'] },
    ]
    beforeEach(() => {
        Object.assign(mockUser, { defaultProjectId: 'p1', projectIds: ['p1', 'p2', 'p3'] })
        mockProjectsMap = Object.fromEntries(projects.map(project => [project.id, project]))
        mockExtraAssistants = { p2: [cto] }
        // The workspace shows the open tasks of "Home".
        mockWorkspaceState = {
            loggedUserProjects: projects,
            loggedUserProjectsMap: mockProjectsMap,
            selectedProjectIndex: 0,
            route: 'ROOT_NOTES',
            selectedSidebarTab: 'ROOT_NOTES',
        }
        mockDispatch.mockClear()
        NavigationService.navigate.mockClear()
    })
    afterEach(() => {
        delete mockUser.defaultProjectId
        delete mockUser.projectIds
    })
    const switcher = () => mockConversationProps.renderProjectSwitcher({ disabled: false })
    const lastProject = () => useAnnaConversation.mock.calls.at(-1)[1].projectId
    const projectSwitches = () =>
        mockDispatch.mock.calls
            .map(([actions]) => (Array.isArray(actions) ? actions.find(action => action.type === 'PROJECT') : null))
            .filter(Boolean)
            .map(action => action.index)

    it('moves the workspace when the composer’s project chip picks a project, keeping the view', () => {
        render(content(1))
        act(() => switcher().props.onSelect('p3'))
        expect(lastProject()).toBe('p3')
        expect(mockDispatch).toHaveBeenLastCalledWith([
            { type: 'PROJECT', index: 2 },
            { type: 'CURRENT_USER', user: mockUser },
            { type: 'PROJECT_TYPE', projectType: 'active' },
            { type: 'SIDEBAR_TAB', tab: 'ROOT_NOTES' },
        ])
        expect(NavigationService.navigate).not.toHaveBeenCalled()
    })

    it('moves the workspace when the assistant picker at the top left picks a project', () => {
        render(content(1))
        fireEvent.click(document.querySelector('.anna-header-left .anna-assistant-picker'))
        const product = [...document.querySelectorAll('.anna-project-option')].find(row =>
            row.textContent.includes('Alldone Product')
        )
        fireEvent.click(product)
        expect(lastProject()).toBe('p2')
        expect(projectSwitches()).toEqual([1])
    })

    it('opens another project’s chat from a jump and moves the workspace with it', () => {
        const otherThreads = [{ projectId: 'p3', chatId: 'AnnaChat20261113u1', created: 1 }]
        useAnnaConversation.mockReturnValue({ ...state, otherThreads })
        render(content(1))
        expect(mockConversationProps.otherThreads).toBe(otherThreads)
        act(() => mockConversationProps.onOpenProject('p3'))
        expect(lastProject()).toBe('p3')
        expect(projectSwitches()).toEqual([2])
    })

    it('keeps only the last of several quick picks, in the chat and in the workspace', () => {
        render(content(1))
        act(() => {
            switcher().props.onSelect('p2')
            switcher().props.onSelect('p3')
        })
        act(() => switcher().props.onSelect('p2'))
        expect(lastProject()).toBe('p2')
        expect(projectSwitches().at(-1)).toBe(1)
    })

    it('does not move a workspace that already shows the project, nor All projects for "Automatic"', () => {
        render(content(1))
        act(() => switcher().props.onSelect('p1'))
        mockWorkspaceState.selectedProjectIndex = -1
        act(() => switcher().props.onSelect(':automatic'))
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('does not move the workspace when assistant mode is entered from an assistant line (AT-3034)', () => {
        setAnnaMode(false)
        render(
            <AnnaShell routeId={1}>
                <AssistantModeButton inline projectId="p3" assistantName="Line assistant" />
            </AnnaShell>
        )
        fireEvent.click(screen.getByLabelText('Line assistant: Open assistant chat'))
        expect(lastProject()).toBe('p3')
        expect(projectSwitches()).toEqual([])
    })

    // AT-3036 follow-up: the other direction. The person opens a project in the workspace and the
    // chat follows: that project's chat, answered by that project's assistant.
    describe('the chat follows a project opened in the workspace', () => {
        const indexOf = { p1: 0, p2: 1, p3: 2, all: -1 }
        // What the store looks like after a navigation in the workspace (redux is mocked here).
        const workspaceShows = (view, project, route = 'ROOT_NOTES') => {
            mockWorkspaceState = { ...mockWorkspaceState, selectedProjectIndex: indexOf[project], route }
            view.rerender(content(1))
        }
        // The person's press in the workspace (the app sidebar, a list) or in the chat pane.
        const press = target => act(() => target.dispatchEvent(new Event('pointerdown', { bubbles: true })))
        const pressWorkspace = () => press(screen.getByLabelText('Real workspace editor'))
        const pressChat = () => press(screen.getByLabelText('Persistent conversation'))
        const headerAssistant = () => document.querySelector('.anna-header-assistant').getAttribute('aria-label')

        it('selects the opened project and previews its own assistant, without moving the workspace back', () => {
            const view = render(content(1))
            pressWorkspace()
            workspaceShows(view, 'p2')
            expect(lastProject()).toBe('p2')
            // (The chip's project comes from the mocked conversation hook; only the mode is real here.)
            expect(switcher().props.activeProjectId).not.toBe(':automatic')
            expect(mockConversationProps.projectSwitch).toMatchObject({ projectId: 'p2', name: 'Alldone Product' })
            expect(projectSwitches()).toEqual([])
            useAnnaConversation.mockReturnValue({ ...state, activeProjectId: 'p2', switching: true })
            view.rerender(content(1))
            expect(headerAssistant()).toBe('Alldone CTO – Latest messages')
        })

        it('falls back to the default assistant in a project without one of its own', () => {
            const view = render(content(1))
            pressWorkspace()
            workspaceShows(view, 'p3')
            expect(lastProject()).toBe('p3')
            useAnnaConversation.mockReturnValue({ ...state, activeProjectId: 'p3', switching: true })
            view.rerender(content(1))
            expect(headerAssistant()).toBe('Anna Alldone – Latest messages')
        })

        it('goes back to "Automatic" on All projects or the default project', () => {
            const view = render(content(1))
            pressWorkspace()
            workspaceShows(view, 'p3')
            expect(lastProject()).toBe('p3')
            pressWorkspace()
            workspaceShows(view, 'all', 'ROOT_TASKS')
            expect(lastProject()).toBe('p1')
            expect(switcher().props.activeProjectId).toBe(':automatic')
            pressWorkspace()
            workspaceShows(view, 'p2')
            pressWorkspace()
            workspaceShows(view, 'p1')
            expect(switcher().props.activeProjectId).toBe(':automatic')
        })

        it('ignores project changes nobody made in the workspace (assistant reveal, chat links)', () => {
            const view = render(content(1))
            workspaceShows(view, 'p3', 'ROOT_TASKS')
            expect(lastProject()).toBe('p1')
            // A press in the chat (an activity row, a link in an answer) is the chat's side.
            pressChat()
            workspaceShows(view, 'p2', 'ROOT_TASKS')
            expect(lastProject()).toBe('p1')
            // A press long ago is no intent for a change now.
            const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
            pressWorkspace()
            now.mockReturnValue(1000 + 4001)
            workspaceShows(view, 'p3')
            now.mockRestore()
            expect(lastProject()).toBe('p1')
        })

        it('takes one press as one change, so a later programmatic change stays programmatic', () => {
            const view = render(content(1))
            pressWorkspace()
            workspaceShows(view, 'p3')
            expect(lastProject()).toBe('p3')
            workspaceShows(view, 'p2')
            expect(lastProject()).toBe('p3')
        })

        it('does not follow into an object’s detail view, nor when assistant mode is off', () => {
            const view = render(content(1))
            pressWorkspace()
            workspaceShows(view, 'p3', 'TaskDetailedView')
            expect(lastProject()).toBe('p1')
            act(() => setAnnaMode(false))
            pressWorkspace()
            workspaceShows(view, 'p2')
            expect(lastProject()).toBe('p1')
        })

        it('keeps the latest choice of both sides, without a loop (rapid navigation)', () => {
            const view = render(content(1))
            // Two quick projects in the workspace: the second wins.
            pressWorkspace()
            workspaceShows(view, 'p2')
            pressWorkspace()
            workspaceShows(view, 'p3')
            expect(lastProject()).toBe('p3')
            expect(projectSwitches()).toEqual([])
            // Then the chat's chip: it wins and moves the workspace, once.
            pressChat()
            act(() => switcher().props.onSelect('p2'))
            expect(lastProject()).toBe('p2')
            expect(projectSwitches()).toEqual([1])
            // The workspace arrives there; nothing bounces back.
            workspaceShows(view, 'p2')
            expect(lastProject()).toBe('p2')
            expect(projectSwitches()).toEqual([1])
        })

        it('never bounces a late workspace sync back over a newer chat choice', () => {
            const view = render(content(1))
            // A press in the workspace just before, then two quick picks in the chat (no chat press
            // here: the picks are called directly, so only the sync bookkeeping protects them).
            pressWorkspace()
            act(() => switcher().props.onSelect('p2'))
            act(() => switcher().props.onSelect('p3'))
            expect(projectSwitches()).toEqual([1, 2])
            // The workspace still passes through the first sync's project on its way.
            workspaceShows(view, 'p2')
            workspaceShows(view, 'p3')
            expect(lastProject()).toBe('p3')
            expect(projectSwitches()).toEqual([1, 2])
        })

        it('does not switch during a voice call', () => {
            mockCallStatus = 'active'
            try {
                const view = render(content(1))
                pressWorkspace()
                workspaceShows(view, 'p2')
                expect(lastProject()).toBe('p1')
            } finally {
                mockCallStatus = 'idle'
            }
        })
    })
})

describe('opening an activity row (AT-2906)', () => {
    const deferred = () => {
        let resolve
        const promise = new Promise(done => {
            resolve = done
        })
        return { promise, resolve }
    }
    const renderRows = paths => {
        setAnnaLayout('chat')
        render(
            <AnnaShell>
                {paths.map(path => (
                    <a key={path} href={path} data-anna-activity-link="">
                        {path}
                    </a>
                ))}
            </AnnaShell>
        )
        return [...testContainer.querySelectorAll('a')]
    }
    afterEach(() => {
        resolveAnnaActivityPath.mockReset().mockImplementation(async path => ({ path }))
        URLTrigger.processUrl.mockReset().mockResolvedValue(undefined)
    })

    it('opens the resolved object, not the path the row was saved with', async () => {
        resolveAnnaActivityPath.mockResolvedValueOnce({ path: '/projects/p1/tasks/t1/chat' })
        const [row] = renderRows(['/projects/p1/chats/t1/chat'])
        await act(async () => row.click())
        expect(resolveAnnaActivityPath).toHaveBeenCalledWith('/projects/p1/chats/t1/chat')
        expect(URLTrigger.processUrl).toHaveBeenLastCalledWith({}, '/projects/p1/tasks/t1/chat')
        expect(document.querySelector('.anna-chat-only')).toBeNull()
    })

    it('says why a missing target cannot open and does not navigate anywhere', async () => {
        resolveAnnaActivityPath.mockResolvedValueOnce({ error: 'missing' })
        const [row] = renderRows(['/projects/p1/tasks/gone/properties'])
        await act(async () => row.click())
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(document.querySelector('.anna-error[role="alert"]').textContent).toContain('target:missing')
        // The assistant stays where it was: no workspace switch on a failed click.
        expect(document.querySelector('.anna-chat-only')).toBeTruthy()
    })

    it('ordinary links are not checked', async () => {
        setAnnaLayout('chat')
        render(
            <AnnaShell>
                <a href="/projects/p1/user/u1/updates/followed">Inbox</a>
            </AnnaShell>
        )
        await act(async () => testContainer.querySelector('a').click())
        expect(resolveAnnaActivityPath).not.toHaveBeenCalled()
        expect(URLTrigger.processUrl).toHaveBeenLastCalledWith({}, '/projects/p1/user/u1/updates/followed')
    })

    it('opens only the last of two quick clicks, even when the first resolves later', async () => {
        const first = deferred()
        resolveAnnaActivityPath.mockImplementationOnce(() => first.promise)
        const [a, b] = renderRows(['/projects/p1/tasks/a/properties', '/projects/p1/notes/b/editor'])
        await act(async () => a.click())
        await act(async () => b.click())
        await act(async () => first.resolve({ path: '/projects/p1/tasks/a/properties' }))
        expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual(['/projects/p1/notes/b/editor'])
    })

    it('waits for a navigation still in progress so the later click lands last', async () => {
        const firstRoute = deferred()
        URLTrigger.processUrl.mockImplementationOnce(() => firstRoute.promise)
        const [a, b] = renderRows(['/projects/p1/tasks/a/properties', '/projects/p1/notes/b/editor'])
        await act(async () => a.click())
        await act(async () => b.click())
        expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual(['/projects/p1/tasks/a/properties'])
        await act(async () => firstRoute.resolve())
        expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual([
            '/projects/p1/tasks/a/properties',
            '/projects/p1/notes/b/editor',
        ])
    })
})

describe('an app view (MCP Apps, e.g. Judy) in the right pane', () => {
    const judyView = (viewId, filter) => ({
        viewId,
        appName: 'Judy Job',
        serverId: 'alldone_team',
        resourceUri: 'ui://judy/app.html',
        toolName: 'judy_show',
        toolArguments: { view: 'matches', specialty: filter },
        createdAt: Date.now(),
    })
    const appOptions = () =>
        [...document.querySelector('.anna-header-picker select').options]
            .map(option => option.value)
            .filter(value => value.startsWith('app:'))

    it('closes the pane and shows Alldone again when the view asks to go back to the chat', () => {
        render(content(1))
        act(() => mockAppPane.open(judyView('v1', 'all'), { auto: true }))
        expect(selectedSurface()).toBe('app:v1')
        act(() => mockAppFrames.v1.onClose())
        expect(selectedSurface()).toBe('alldone')
        // The view stays mounted, so its card reopens it as it was.
        expect(document.querySelector('[data-testid="app-frame-v1"]')).toBeTruthy()
        expect(appOptions()).toEqual(['app:v1'])
    })

    it('ignores a close request from a view that is not the one shown', () => {
        render(content(1))
        act(() => mockAppPane.open(judyView('v1', 'all')))
        act(() => mockAppPane.open({ ...judyView('s1'), serverId: 'story', resourceUri: 'ui://story/app.html' }))
        act(() => mockAppFrames.v1.onClose())
        expect(selectedSurface()).toBe('app:s1')
    })

    it('keeps one pane per app: a newer view of the same app replaces the older one', () => {
        render(content(1))
        act(() => mockAppPane.open(judyView('v1', 'dermatology'), { auto: true }))
        act(() => mockAppPane.open(judyView('v2', 'all'), { auto: true }))
        expect(selectedSurface()).toBe('app:v2')
        expect(appOptions()).toEqual(['app:v2'])
        expect(document.querySelector('[data-testid="app-frame-v1"]')).toBeNull()
    })

    it("holds the assistant's own presentation while the app is open, as for a VM", async () => {
        const view = render(content(1))
        act(() => mockAppPane.open(judyView('v1', 'all'), { auto: true }))
        useAnnaConversation.mockReturnValue({
            ...state,
            conversation: {
                ...conversation,
                annaPresentation: {
                    id: 'tracking-task',
                    view: 'task',
                    path: '/projects/p1/tasks/t1/chat',
                    title: 'Track Judy work',
                    createdAt: Date.now(),
                },
            },
        })
        view.rerender(content(1))
        await act(async () => {})
        expect(URLTrigger.processUrl).not.toHaveBeenCalled()
        expect(selectedSurface()).toBe('app:v1')
        expect(document.querySelector('.anna-pending')).toBeTruthy()
    })

    it('reveals a saved task only once the app is closed', async () => {
        jest.useFakeTimers()
        const visibility = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
        const change = {
            id: 'saved1',
            projectId: 'p1',
            objectId: 'task1',
            type: 'task',
            change: 'updated',
            path: '/projects/p1/tasks/task1/properties',
            expiresAt: Date.now() + 120000,
        }
        try {
            const view = render(content(1))
            act(() => mockAppPane.open(judyView('v1', 'all'), { auto: true }))
            useAnnaConversation.mockReturnValue({
                ...state,
                conversation: { ...conversation, annaWorkspaceChanges: [change] },
            })
            view.rerender(content(1))
            for (let i = 0; i < 10; i++) await act(async () => jest.advanceTimersByTime(75))
            expect(URLTrigger.processUrl).not.toHaveBeenCalled()
            expect(selectedSurface()).toBe('app:v1')
            act(() => mockAppFrames.v1.onClose())
            for (let i = 0; i < 10; i++) await act(async () => jest.advanceTimersByTime(75))
            expect(URLTrigger.processUrl).toHaveBeenCalledWith({}, change.path)
        } finally {
            visibility.mockRestore()
            jest.useRealTimers()
        }
    })
})

describe('an embedded app handed over from its window (AT-2951)', () => {
    const { getAnnaAppPaneState, iframeAppView, openInAnnaAppPane } = require('./annaAppPaneBridge')
    const url = 'https://alldone.team/story-builder?embed=true'
    const frame = () => document.querySelector(`[data-testid="embedded-frame-${url}"]`)

    it('tells the embed windows whether assistant mode is open', () => {
        expect(getAnnaAppPaneState()).toBe('none')
        setAnnaMode(false)
        render(content(1))
        expect(getAnnaAppPaneState()).toBe('available')
        act(() => setAnnaMode(true))
        expect(getAnnaAppPaneState()).toBe('active')
        act(() => testRoot.unmount())
        testRoot = null
        expect(getAnnaAppPaneState()).toBe('none')
    })

    it('switches to assistant mode with the sidebar on the left and the app in the right pane', () => {
        setAnnaMode(false)
        render(content(1))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()

        let opened
        act(() => {
            opened = openInAnnaAppPane(iframeAppView(url, 'Story Builder'))
        })

        expect(opened).toBe(true)
        expect(document.querySelector('.anna-zoom-active')).toBeTruthy()
        expect(document.querySelector('.anna-chat-only')).toBeNull()
        expect(selectedSurface()).toBe(`app:iframe:${url}`)
        expect(frame()).toBeTruthy()
        expect(frame().closest('.anna-surface-hidden')).toBeNull()
        expect(mockEmbeddedFrames[url]).toEqual(expect.objectContaining({ url, title: 'Story Builder' }))
        const option = [...document.querySelector('.anna-header-picker select').options].find(
            item => item.value === `app:iframe:${url}`
        )
        expect(option.textContent).toBe('Story Builder')
        // The workspace keeps its state: switching never remounts the Alldone route.
        expect(mockUnmounts).toBe(0)
    })

    it('tells the assistant which app the pane shows, and what the app reported (AT-2955)', async () => {
        const { setAppModelContext, clearAppModelContext } = require('../../utils/annaAppModelContext')
        setAppModelContext(`iframe:${url}`, { text: 'Story: MCP, Juno & AI, scene 3 of 25' })
        try {
            render(content(1))
            mockUpdate.mockClear()
            await act(async () => {
                openInAnnaAppPane(iframeAppView(url, 'Story Builder'))
            })
            // The frame is wired to report into this view's slot.
            expect(mockEmbeddedFrames[url].contextId).toBe(`iframe:${url}`)
            // The chat's "Looking at" names the app, never the hidden Alldone page behind it.
            expect(mockConversationProps.pageContext).toMatchObject({ surface: 'app', title: 'Story Builder' })
            expect(mockUpdate).toHaveBeenCalledWith({
                annaPageContext: {
                    path: '/',
                    title: 'Story Builder',
                    surface: 'app',
                    app: {
                        kind: 'iframe',
                        name: 'Story Builder',
                        origin: 'https://alldone.team',
                        state: expect.objectContaining({ text: 'Story: MCP, Juno & AI, scene 3 of 25' }),
                    },
                },
            })
        } finally {
            clearAppModelContext(`iframe:${url}`)
        }
    })

    it('shows an app opened from chat-only mode next to the chat', () => {
        render(content(1))
        act(() => setAnnaLayout('chat'))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        expect(document.querySelector('.anna-chat-only')).toBeNull()
        expect(selectedSurface()).toBe(`app:iframe:${url}`)
    })

    it('reselects the pane when the same app is opened again', () => {
        render(content(1))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        chooseSurface('alldone')
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        expect(selectedSurface()).toBe(`app:iframe:${url}`)
        expect(document.querySelectorAll(`[data-testid="embedded-frame-${url}"]`)).toHaveLength(1)
    })

    it('shows the Alldone workspace when the app opens an Alldone object', () => {
        render(content(1))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Roadmap')))
        act(() => mockEmbeddedFrames[url].onNavigateAway())
        expect(selectedSurface()).toBe('alldone')
        expect(frame()).toBeTruthy()
    })
})

describe('opening the pane’s embedded app in a new tab (AT-2954)', () => {
    const { iframeAppView, openInAnnaAppPane } = require('./annaAppPaneBridge')
    const url = 'https://alldone.team/story-builder'
    const judy = { viewId: 'v1', appName: 'Judy Job', serverId: 'team', resourceUri: 'ui://judy/app.html' }
    const frame = () => document.querySelector(`[data-testid="embedded-frame-${url}"]`)
    const button = () => document.querySelector('[data-testid="anna-app-open-in-new-tab"]')
    let open

    beforeEach(() => {
        open = jest.spyOn(window, 'open').mockReturnValue({})
    })
    afterEach(() => open.mockRestore())

    it('sits immediately left of the X while an embedded app is on screen', () => {
        render(content(1))
        expect(button()).toBeNull()
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))

        expect(button()).toBeTruthy()
        expect(button().getAttribute('aria-label')).toBe('Open app in new tab')
        expect(button().getAttribute('title')).toBe('Open app in new tab')
        expect(button().nextElementSibling.getAttribute('aria-label')).toBe('Close assistant chat')

        chooseSurface('alldone')
        expect(button()).toBeNull()
    })

    it('is not offered for an MCP app view, which has no address', () => {
        render(content(1))
        act(() => openInAnnaAppPane(judy))
        expect(button()).toBeNull()
    })

    it('opens the page the app reported, closes the pane’s copy and shows Alldone', () => {
        render(content(1))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        act(() => mockEmbeddedFrames[url].onLocationChange(`${url}/story-7?step=2`))

        fireEvent.click(button())

        expect(open).toHaveBeenCalledWith(`${url}/story-7?step=2`, '_blank')
        expect(selectedSurface()).toBe('alldone')
        expect(frame()).toBeNull()
        const options = [...document.querySelector('.anna-header-picker select').options].map(item => item.value)
        expect(options).not.toContain(`app:iframe:${url}`)
    })

    it('opens the start URL when the app reported nothing, including after reopening it', () => {
        render(content(1))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        act(() => mockEmbeddedFrames[url].onLocationChange(`${url}/old`))
        fireEvent.click(button())
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))
        fireEvent.click(button())
        expect(open).toHaveBeenLastCalledWith(url, '_blank')
    })

    it('keeps the app in the pane and explains a blocked pop-up', () => {
        open.mockReturnValue(null)
        render(content(1))
        act(() => openInAnnaAppPane(iframeAppView(url, 'Story Builder')))

        fireEvent.click(button())

        expect(selectedSurface()).toBe(`app:iframe:${url}`)
        expect(frame()).toBeTruthy()
        expect(document.querySelector('[role="alert"]').textContent).toContain('embedded_app_popup_blocked')
    })
})

describe('leaving assistant mode returns the app in the pane to its embed window (AT-2951)', () => {
    const { iframeAppView, openInAnnaAppPane, registerEmbedWindow } = require('./annaAppPaneBridge')
    const url = 'https://alldone.team/story-builder?embed=true'
    const storyBuilder = iframeAppView(url, 'Story Builder')
    const judy = { viewId: 'v1', appName: 'Judy Job', serverId: 'team', resourceUri: 'ui://judy/app.html' }
    const iframeFrame = () => document.querySelector(`[data-testid="embedded-frame-${url}"]`)
    let iframeWindow
    let mcpWindow
    let unregister

    beforeEach(() => {
        iframeWindow = jest.fn()
        mcpWindow = jest.fn()
        const offIframe = registerEmbedWindow('iframe', iframeWindow)
        const offMcp = registerEmbedWindow('mcp', mcpWindow)
        unregister = () => {
            offIframe()
            offMcp()
        }
    })
    afterEach(() => unregister())

    it('opens a tool page in its window again when the chat is closed', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        expect(iframeFrame()).toBeTruthy()

        fireEvent.click(screen.getByLabelText('Close assistant chat'))

        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(iframeWindow).toHaveBeenCalledTimes(1)
        expect(iframeWindow).toHaveBeenCalledWith(storyBuilder)
        expect(mcpWindow).not.toHaveBeenCalled()
        // The pane's copy is closed: the app never runs twice.
        expect(iframeFrame()).toBeNull()
        expect(mockUnmounts).toBe(0)
    })

    it('opens an MCP app in its window again when assistant mode is switched off elsewhere', () => {
        render(content(1))
        act(() => openInAnnaAppPane(judy))
        act(() => setAnnaMode(false))

        expect(mcpWindow).toHaveBeenCalledTimes(1)
        expect(mcpWindow).toHaveBeenCalledWith(judy)
        expect(iframeWindow).not.toHaveBeenCalled()
        expect(document.querySelector('[data-testid="app-frame-v1"]')).toBeNull()
    })

    it('hands back only once and not again when assistant mode is reopened and left', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        act(() => setAnnaMode(false))
        act(() => setAnnaMode(true))
        act(() => setAnnaMode(false))
        expect(iframeWindow).toHaveBeenCalledTimes(1)
    })

    it('hands back the app on screen, not one hidden behind the picker', () => {
        render(content(1))
        act(() => openInAnnaAppPane(judy))
        act(() => openInAnnaAppPane(storyBuilder))
        fireEvent.click(screen.getByLabelText('Close assistant chat'))
        expect(iframeWindow).toHaveBeenCalledWith(storyBuilder)
        expect(mcpWindow).not.toHaveBeenCalled()
        // The other app stays in the pane as before.
        expect(document.querySelector('[data-testid="app-frame-v1"]')).toBeTruthy()
    })

    it('returns nothing when Alldone is selected', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        chooseSurface('alldone')
        fireEvent.click(screen.getByLabelText('Close assistant chat'))
        expect(iframeWindow).not.toHaveBeenCalled()
        expect(iframeFrame()).toBeTruthy()
    })

    it('also returns the app selected in the hidden pane when leaving from chat-only mode', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        act(() => setAnnaLayout('chat'))
        expect(document.querySelector('.anna-chat-only')).toBeTruthy()
        fireEvent.click(screen.getByLabelText('Close assistant chat'))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(iframeWindow).toHaveBeenCalledTimes(1)
        expect(iframeWindow).toHaveBeenCalledWith(storyBuilder)
        expect(iframeFrame()).toBeNull()
    })

    it('returns nothing from chat-only mode when Alldone was the pane selection', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        chooseSurface('alldone')
        act(() => setAnnaLayout('chat'))
        fireEvent.click(screen.getByLabelText('Close assistant chat'))
        expect(iframeWindow).not.toHaveBeenCalled()
    })

    it('returns nothing when the chat-only Home button leaves for the task list', () => {
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        act(() => setAnnaLayout('chat'))
        fireEvent.click(document.querySelector('.anna-header-tasks'))
        expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
        expect(iframeWindow).not.toHaveBeenCalled()
    })

    describe('on a phone', () => {
        const originalMatchMedia = window.matchMedia
        beforeEach(() => {
            window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
        })
        afterEach(() => {
            if (originalMatchMedia) window.matchMedia = originalMatchMedia
            else delete window.matchMedia
        })

        it('opens the app in its window again when the chat is closed', () => {
            render(content(1))
            act(() => openInAnnaAppPane(storyBuilder))
            fireEvent.click(screen.getByLabelText('Close assistant chat'))
            expect(iframeWindow).toHaveBeenCalledWith(storyBuilder)
        })

        it('returns nothing when Alldone is chosen in the picker', () => {
            render(content(1))
            act(() => openInAnnaAppPane(storyBuilder))
            chooseSurface('alldone')
            expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
            expect(iframeWindow).not.toHaveBeenCalled()
        })

        it('returns nothing when the Home button leaves for the task list', () => {
            render(content(1))
            act(() => openInAnnaAppPane(storyBuilder))
            fireEvent.click(document.querySelector('.anna-header-tasks'))
            expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
            expect(iframeWindow).not.toHaveBeenCalled()
        })
    })

    it('keeps the app in the pane when no embed window is mounted', () => {
        unregister()
        unregister = () => {}
        render(content(1))
        act(() => openInAnnaAppPane(storyBuilder))
        act(() => setAnnaMode(false))
        expect(iframeFrame()).toBeTruthy()
    })
})
