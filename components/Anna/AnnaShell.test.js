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
import { setAnnaMode } from '../../utils/annaMode'

const mockSet = jest.fn().mockResolvedValue(undefined)
const mockSnapshots = {}
let mockBrowserProps
let mockConversationProps
let mockTransactionState
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
const mockUpdate = jest.fn().mockResolvedValue(undefined)
const mockUser = { uid: 'u1', gold: 100, displayName: 'Test user' }
let mockAssistant
const mockDefaultAssistant = { uid: 'anna', displayName: 'Anna Alldone' }
let mockUnmounts = 0
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUser: mockUser,
            defaultAssistant: mockDefaultAssistant,
            projectAssistants: { p1: [mockAssistant] },
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
jest.mock('../../redux/actions', () => ({ showGlobalSearchPopup: () => ({ type: 'SEARCH' }) }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? ''),
    useTranslator: () => {},
}))

const conversation = { id: 'anna_u1', projectId: 'p1', assistantId: 'a1' }
const state = { conversation, loading: false, error: '', retry: jest.fn() }
const content = id => (
    <AnnaShell routeId={id}>
        <input aria-label="Real workspace editor" defaultValue="Unsaved note" />
    </AnnaShell>
)

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    setAnnaMode(true)
    mockAssistant = { uid: 'a1', displayName: 'Carl Code Mentor' }
    mockUnmounts = 0
    mockBrowserProps = null
    mockConversationProps = null
    mockTransactionState = {}
    jest.clearAllMocks()
    mockReleaseBrowser.mockResolvedValue(undefined)
    mockRunTransaction.mockImplementation(fn =>
        fn({ get: async () => ({ data: () => mockTransactionState }), set: mockSet })
    )
    useAnnaConversation.mockReturnValue(state)
})

it('places the surface selector and hand-back control in the top bar', () => {
    render(content(1))
    const toolbar = document.querySelector('.anna-header .anna-workspace-toolbar')
    expect(toolbar.textContent).toContain('Alldone')
    expect(toolbar.textContent).toContain('Browser')
    expect(toolbar.textContent).toContain('Take control')
    expect(document.querySelector('.anna-stage .anna-workspace-toolbar')).toBeNull()
    expect(document.querySelector('.anna-header').textContent).not.toContain('Looking at:')
})

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
        await act(async () => screen.getByText('Browser').click())
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

it('hands both surfaces back for a new message without queueing a second continuation', async () => {
    render(content(1))
    await act(async () => fireEvent.click(screen.getByText('Take control')))
    mockTransactionState = {
        blocked: { projectId: 'p1', objectId: 'anna_u1', objectType: 'topics', assistantId: 'a1', at: 456 },
    }
    act(() => mockBrowserProps.onControlChange(true))
    await act(async () => mockConversationProps.onBeforeSend())
    expect(mockSet).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ control: 'assistant', blocked: null }),
        { merge: true }
    )
    expect(mockReleaseBrowser).toHaveBeenCalledTimes(1)
    expect(mockConversationProps.resumeRequest).toBeNull()
    expect(screen.getByText('Take control').getAttribute('aria-pressed')).toBe('false')
})

it('waits for a pending take-control write before resuming for a message', async () => {
    let finishTake
    const takingControl = new Promise(resolve => {
        finishTake = resolve
    })
    mockRunTransaction.mockImplementationOnce(async fn => {
        await takingControl
        return fn({ get: async () => ({ data: () => mockTransactionState }), set: mockSet })
    })
    render(content(1))
    fireEvent.click(screen.getByText('Take control'))
    let resume
    act(() => {
        resume = mockConversationProps.onBeforeSend()
    })
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    await act(async () => {
        finishTake()
        await resume
    })
    expect(mockRunTransaction).toHaveBeenCalledTimes(2)
    expect(mockSet.mock.calls.map(args => args[1]?.control).filter(Boolean)).toEqual(['user', 'assistant'])
})

it('clears persisted user control even before its snapshot reaches the UI', async () => {
    mockTransactionState = { control: 'user', blocked: { objectId: 'paused-task' } }
    render(content(1))
    await act(async () => mockConversationProps.onBeforeSend())
    expect(mockSet).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ control: 'assistant', blocked: null }),
        { merge: true }
    )
    expect(mockConversationProps.resumeRequest).toBeNull()
})

it('keeps user control when hand-back fails and does not resume the browser', async () => {
    render(content(1))
    await act(async () => fireEvent.click(screen.getByText('Take control')))
    act(() => mockBrowserProps.onControlChange(true))
    mockRunTransaction.mockRejectedValueOnce(new Error('Offline'))
    await act(async () => {
        await expect(mockConversationProps.onBeforeSend()).rejects.toThrow('Could not change workspace control')
    })
    expect(screen.getByText('Let Carl Code Mentor continue').getAttribute('aria-pressed')).toBe('true')
    expect(mockReleaseBrowser).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByText('Zoom in Alldone'))
    expect(document.querySelector('.anna-fullscreen')).toBeTruthy()
    act(() => setAnnaMode(true))
    expect(screen.getByLabelText('Real workspace editor')).toBe(workspace)
    expect(workspace.value).toBe('Work in progress')
    expect(screen.getByLabelText('Persistent conversation')).toBe(chat)
    expect(chat.value).toBe('Unsent message')
    expect(mockUnmounts).toBe(0)
    await act(async () => {})
})

it('holds assistant navigation after the user takes control, until Open is clicked', async () => {
    const view = render(content(1))
    view.rerender(content(2))
    await act(async () => fireEvent.click(screen.getByText('Take control')))
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

it('switches mobile panes without removing the workspace or chat', async () => {
    window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    render(content(1))
    const stage = screen.getByLabelText('Alldone workspace')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    const tabs = document.querySelector('.anna-mobile-tabs')
    fireEvent.click([...tabs.querySelectorAll('button')].find(button => button.textContent === 'Workspace'))
    expect(stage.getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByLabelText('Persistent conversation')).toBeTruthy()
    expect(screen.getByLabelText('Real workspace editor')).toBeTruthy()
    delete window.matchMedia
    await act(async () => {})
})

it('resumes a returned browser while the user still controls Alldone', async () => {
    render(content(1))
    await act(async () => fireEvent.click(screen.getByText('Take control')))
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
    expect(screen.getByText('Let Carl Code Mentor continue').getAttribute('aria-pressed')).toBe('true')
})

it('resumes returned Alldone work while the user still controls the browser', async () => {
    render(content(1))
    await act(async () => fireEvent.click(screen.getByText('Take control')))
    act(() => mockBrowserProps.onControlChange(true))
    mockTransactionState = {
        blocked: { projectId: 'p1', objectId: 'anna_u1', objectType: 'topics', assistantId: 'a1', at: 456 },
    }
    await act(async () => fireEvent.click(screen.getByText('Let Carl Code Mentor continue')))
    expect(mockConversationProps.resumeRequest).toMatchObject({
        surface: 'alldone',
        text: 'I have returned Alldone control to you. Please continue my current request.',
    })
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
