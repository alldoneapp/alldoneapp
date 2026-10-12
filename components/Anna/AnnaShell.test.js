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
import { setAnnaMode, setAnnaLayout } from '../../utils/annaMode'
import AnnaBrowserTakeoverContext from './AnnaBrowserTakeoverContext'
import DefaultAssistantButton from '../SidebarMenu/DefaultAssistantButton'
jest.mock('../SidebarMenu/Themes', () => ({
    Themes: { modern: { CustomSideMenu: { AllProjects: {} } } },
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
const mockUser = { uid: 'u1', gold: 100, displayName: 'Test user' }
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
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { createNavigationProp: () => ({}) } }))
jest.mock('../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('../../redux/actions', () => ({
    showGlobalSearchPopup: () => ({ type: 'SEARCH' }),
    hideWebSideBar: () => ({ type: 'HIDE_SIDEBAR' }),
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? ''),
    useTranslator: () => {},
}))

const conversation = { id: 'anna_u1', projectId: 'p1', assistantId: 'a1' }
const state = { conversation, loading: false, error: '', retry: jest.fn() }
const content = (id, withSidebar = false) => (
    <AnnaShell routeId={id}>
        {withSidebar && <DefaultAssistantButton />}
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
const showChat = () => choose(document.querySelector('.anna-workspace-switcher select'), 'chat')
const showWorkspace = () => fireEvent.click(screen.getByLabelText('Show workspace'))

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
            if (device === 'mobile')
                expect(document.querySelector('.anna-workspace-switcher select').value).toBe('browser')
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

it.each([
    ['mobile', 'alldone'],
    ['mobile', 'workspace'],
    ['desktop', 'alldone'],
    ['desktop', 'workspace'],
    ['desktop', 'chat'],
])('opens the chat from the default assistant sidebar button on %s from %s', (device, start) => {
    const originalMatchMedia = window.matchMedia
    mockMobileNavigation = device === 'mobile'
    window.matchMedia = () => ({
        matches: mockMobileNavigation,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })
    try {
        render(content(1, true))
        const workspace = screen.getByLabelText('Real workspace editor')
        const chat = screen.getByLabelText('Persistent conversation')
        workspace.value = 'Keep my note draft'
        chat.value = 'Keep my chat draft'
        if (start === 'alldone') fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
        else if (start === 'workspace') chooseSurface('alldone')

        fireEvent.click(screen.getByLabelText('Anna Alldone'))
        expect(document.querySelector('.anna-zoom-active.anna-mobile-chat')).toBeTruthy()
        expect(screen.getByLabelText('Conversation with Carl Code Mentor').getAttribute('aria-hidden')).toBe('false')
        expect(document.activeElement).toBe(screen.getByLabelText('Conversation with Carl Code Mentor'))
        expect(screen.getByLabelText('Alldone workspace').getAttribute('aria-hidden')).toBe(
            device === 'mobile' ? 'true' : 'false'
        )
        expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
        expect(workspace.value).toBe('Keep my note draft')
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

it('uses the mobile selector and close control without removing the workspace or chat', async () => {
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    render(content(1))
    const stage = screen.getByLabelText('Alldone workspace')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByLabelText('Show workspace')).toBeNull()
    expect(document.querySelector('.anna-pane-toggle-right')).toBeNull()
    chooseSurface('alldone')
    expect(stage.getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByLabelText('Persistent conversation')).toBeTruthy()
    expect(screen.getByLabelText('Real workspace editor')).toBeTruthy()
    showChat()
    fireEvent.click(screen.getByLabelText('Close chat — Alldone only'))
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    expect(stage.getAttribute('aria-hidden')).toBe('false')
    delete window.matchMedia
    await act(async () => {})
})

it('selects mobile workspace surfaces and follows browser completion without losing drafts', () => {
    const originalMatchMedia = window.matchMedia
    const visible = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    mockVmJobs = [{ id: 'vm1', projectId: 'p1', objectId: 't1', title: 'Launch report', status: 'running' }]
    try {
        render(content(1))
        expect(document.querySelector('.anna-header-picker')).toBeTruthy()
        expect(document.querySelector('.anna-workspace-switcher')).toBeNull()
        const editor = screen.getByLabelText('Real workspace editor')
        editor.value = 'My unsaved workspace edit'
        const chat = screen.getByLabelText('Persistent conversation')
        chat.value = 'My unsent chat message'
        chooseSurface('alldone')
        const selector = document.querySelector('.anna-stage select')
        const choose = value =>
            act(() => {
                selector.value = value
                selector.dispatchEvent(new Event('change', { bubbles: true }))
            })
        expect(selector.value).toBe('alldone')
        expect([...selector.options].map(option => option.textContent)).toEqual([
            'Back to chat',
            'Alldone',
            'Browser',
            'VMs',
            'VM · Launch report — running',
        ])
        const finishBrowser = startBrowserActivity()
        expect(selector.value).toBe('browser')
        finishBrowser('completed')
        expect(selector.value).toBe('alldone')
        const finishNext = startBrowserActivity('answer2', 'brun_2')
        choose('vm:vm1')
        finishNext('completed')
        expect(selector.value).toBe('vm:vm1')
        expect(document.querySelector('.anna-workspace-switcher-label').textContent).toContain('VM · Launch report')
        expect(document.querySelector('.anna-vm-surface').getAttribute('aria-hidden')).toBe('false')
        choose('alldone')
        expect(screen.getByLabelText('Real workspace editor')).toBe(editor)
        expect(editor.value).toBe('My unsaved workspace edit')
        showChat()
        expect(document.querySelector('.anna-workspace-switcher')).toBeNull()
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
