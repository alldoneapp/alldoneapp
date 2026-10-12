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
import NavigationService from '../../utils/NavigationService'
import { setAnnaMode, setAnnaLayout } from '../../utils/annaMode'
import AnnaBrowserTakeoverContext from './AnnaBrowserTakeoverContext'
import AnnaWorkspaceNavigationContext from './AnnaWorkspaceNavigationContext'
import LoggedUserSidebarHeader from '../SidebarMenu/LoggedUserSidebar/LoggedUserSidebarHeader'
import ProjectItem from '../SidebarMenu/ProjectFolding/ProjectItem/ProjectItem'
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
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ checkIfSelectedProject: index => index >= 0 }))
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({ updateShowAllProjectsByTime: jest.fn() }))
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: mockUser, smallScreenNavigation: mockMobileNavigation, route: 'Root' }) },
}))

const mockSet = jest.fn().mockResolvedValue(undefined)
const mockSnapshots = {}
let mockBrowserProps
let mockConversationProps
let mockTransactionState
let mockTakeoverProps
let mockTakeoverMounts = 0
let mockVmJobs = []
jest.mock('./useAnnaVmJobs', () => ({
    __esModule: true,
    default: () => ({ jobs: mockVmJobs, error: false, retry: jest.fn() }),
    vmJobPath: job => `/projects/${job.projectId}/tasks/${job.objectId}/chat`,
}))
jest.mock('./AnnaVmWorkspace', () => ({
    __esModule: true,
    default: ({ job }) => <div>Live VM {job.title}</div>,
    vmStatusLabel: value => value,
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
const mockDefaultAssistant = { uid: 'anna', displayName: 'Anna Alldone' }
let mockUnmounts = 0
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector =>
        selector({
            loggedUser: mockUser,
            currentUser: mockUser,
            selectedProjectIndex: -1,
            defaultAssistant: mockDefaultAssistant,
            projectAssistants: { p1: [mockAssistant] },
            sidebarNumbers: mockSidebarNumbers,
            smallScreenNavigation: mockMobileNavigation,
        }),
}))
jest.mock('./useAnnaConversation', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./AnnaConversation', () => ({
    __esModule: true,
    default: props => {
        mockConversationProps = props
        const React = require('react')
        React.useEffect(
            () => () => {
                mockUnmounts++
            },
            []
        )
        return <textarea aria-label="Persistent conversation" />
    },
}))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => mockAssistant }))
jest.mock('../UIComponents/AssistantVoiceCallProvider', () => ({
    useVoiceCall: () => ({ status: 'idle', voiceSeconds: 0 }),
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
    if (value.startsWith('vm:')) choose(document.querySelector('.anna-vm-selector select'), value.slice(3))
}
const showChat = () => choose(document.querySelector('.anna-header-picker select'), 'chat')
const showWorkspace = () => fireEvent.click(screen.getByLabelText('Show workspace'))
const showAlldoneWorkspace = () => fireEvent.click(screen.getByLabelText('Show Alldone with chat'))

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
    fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
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

it('shows an empty VM workspace and keeps its session picker separate from the chat header', () => {
    render(content(1))
    chooseSurface('vms')
    expect(document.querySelector('.anna-vms').textContent).toContain('No VM sessions yet')
    expect(document.querySelector('.anna-header-picker select').options).toHaveLength(3)
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

it.each(['mounted', 'missing', 'interrupted'])(
    'tries the saved task list before details when the row is %s',
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
            expect(URLTrigger.processUrl.mock.calls.map(call => call[1])).toEqual(
                outcome === 'missing' ? [change.listPath, change.path] : [change.listPath]
            )
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
    mockMobileNavigation = false
    mockSidebarNumbers = {}
    global.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    setAnnaMode(true)
    mockAssistant = { uid: 'a1', displayName: 'Carl Code Mentor' }
    mockUnmounts = 0
    mockBrowserProps = null
    mockConversationProps = null
    mockTransactionState = {}
    mockTakeoverProps = null
    mockTakeoverMounts = 0
    mockVmJobs = []
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
    fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
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
    if (!active) fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
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
        if (start === 'alldone') fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
        else if (start === 'workspace') showAlldoneWorkspace()
        else if (start === 'chat-only') act(() => setAnnaLayout('chat'))
        else if (start === 'browser' || start.startsWith('vm:')) chooseSurface(start)

        for (const opens of [start === 'alldone', start !== 'alldone']) {
            fireEvent.click(assistantToggle())
            expect(assistantToggle().getAttribute('aria-expanded')).toBe(String(opens))
            expect(assistantToggle().getAttribute('aria-label')).toBe(
                `Anna Alldone: ${opens ? 'Close assistant chat' : 'Open assistant chat'}`
            )
            expect(assistantToggle().querySelector('path').getAttribute('d')).toBe(opens ? 'm8 8 4 4-4 4' : 'M9 3v18')
            if (opens) {
                const collapseButton = screen.getByLabelText('Close chat — Alldone only')
                const collapseIcon = collapseButton.querySelector('svg')
                expect(collapseIcon.querySelector('path').getAttribute('d')).toBe(
                    assistantToggle().querySelector('path').getAttribute('d')
                )
                expect(collapseIcon.getAttribute('width')).toBe('18')
                expect(collapseIcon.getAttribute('height')).toBe('18')
                expect(collapseIcon.parentElement.getAttribute('aria-hidden')).toBe('true')
                expect(collapseButton.title).toBe('Close chat — Alldone only')
                expect(collapseButton.parentElement.firstElementChild).toBe(collapseButton)
            }
            expect(screen.getByLabelText('Conversation with Carl Code Mentor').getAttribute('aria-hidden')).toBe(
                String(!opens)
            )
            expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe(
                String(opens && device === 'mobile')
            )
            if (opens) {
                expect(document.querySelector('.anna-zoom-active.anna-mobile-chat')).toBeTruthy()
                expect(document.activeElement).toBe(screen.getByLabelText('Conversation with Carl Code Mentor'))
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
        if (start === 'fullscreen') fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
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
            expect(document.querySelector('.anna-pane-toggle-right')).toBeNull()
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
        expect(document.querySelector('.anna-vm-selector select').value).toBe('vm2')
        expect(document.querySelectorAll('.anna-vm-surface')[1].getAttribute('aria-hidden')).toBe('false')
        showChat()
        expect(document.activeElement).toBe(screen.getByLabelText('Conversation with Carl Code Mentor'))
        expect(chat.closest('section').getAttribute('aria-hidden')).toBe('false')
        expect(screen.getByLabelText('Alldone workspace').hasAttribute('inert')).toBe(true)
        chooseSurface('vms')
        expect(document.querySelector('.anna-vm-selector select').value).toBe('vm2')
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

it('uses the conversation assistant for labels and reacts when that assistant is renamed', async () => {
    const view = render(content(1))
    expect(screen.getByText('Carl Code Mentor')).toBeTruthy()
    expect(mockConversationProps.assistant.displayName).toBe('Carl Code Mentor')
    expect(screen.getByLabelText('Conversation with Carl Code Mentor')).toBeTruthy()
    expect(testContainer.textContent).not.toContain('Anna')

    mockAssistant = { ...mockAssistant, displayName: 'Mira' }
    view.rerender(content(1))
    expect(screen.getByText('Mira')).toBeTruthy()
    expect(mockConversationProps.assistant.displayName).toBe('Mira')
    await act(async () => {})
})

it('shows the same live task total as Home beside the assistant name and hides zero', async () => {
    mockSidebarNumbers = { p1: { u1: 20 }, p2: { u1: 7, someoneElse: 90 } }
    const view = render(content(1))
    expect(screen.getByLabelText('27 open tasks today').textContent).toBe('27')
    await act(async () => screen.getByLabelText('27 open tasks today').click())
    expect(URLTrigger.processUrl).toHaveBeenLastCalledWith({}, '/projects/tasks/open')
    mockSidebarNumbers = { p1: { u1: 0 } }
    view.rerender(content(1))
    expect(document.querySelector('.anna-open-tasks-badge')).toBeNull()
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
