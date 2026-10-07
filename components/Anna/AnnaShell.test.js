import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
let testRoot
let testContainer
const screen = {
    getByLabelText: label => document.querySelector(`[aria-label="${label}"]`),
    getByText: text => [...document.querySelectorAll('button, span')].find(node => node.textContent.trim() === text),
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
jest.mock('./AnnaBrowserWorkspace', () => () => null)
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
    default: () => {
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
jest.mock('../UIComponents/AssistantVoiceCallButton', () => ({
    __esModule: true,
    default: props => (
        <button data-project={props.projectId} data-chat={props.chatId}>
            {props.title}
        </button>
    ),
}))
jest.mock('../UIComponents/VoiceMicrophoneStatus', () => ({ __esModule: true, default: () => null }))
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({
        runTransaction: fn => fn({ get: async () => ({ data: () => ({}) }), set: mockSet }),
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
    jest.clearAllMocks()
    useAnnaConversation.mockReturnValue(state)
})

it('keeps the conversation mounted across workspace navigation and uses its topic for voice', async () => {
    const view = render(content(1))
    fireEvent.change(screen.getByLabelText('Persistent conversation'), { target: { value: 'Unsent message' } })
    view.rerender(content(2))
    expect(screen.getByLabelText('Persistent conversation').value).toBe('Unsent message')
    expect(mockUnmounts).toBe(0)
    const voice = screen.getByText('Talk with Carl Code Mentor')
    expect(voice.getAttribute('data-chat')).toBe('anna_u1')
    expect(voice.getAttribute('data-project')).toBe('p1')
    await act(async () => {})
})

it('preserves both editors when zooming out and back without remounting the workspace', async () => {
    const view = render(content(1))
    const workspace = screen.getByLabelText('Real workspace editor')
    const chat = screen.getByLabelText('Persistent conversation')
    workspace.value = 'Work in progress'
    chat.value = 'Unsent message'
    fireEvent.click(screen.getByText('Alldone fullscreen'))
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
    expect(screen.getByText('Talk with Carl Code Mentor')).toBeTruthy()
    expect(screen.getByLabelText('Conversation with Carl Code Mentor')).toBeTruthy()
    expect(testContainer.textContent).not.toContain('Anna')

    mockAssistant = { ...mockAssistant, displayName: 'Mira' }
    view.rerender(content(1))
    expect(screen.getByText('Talk with Mira')).toBeTruthy()
    await act(async () => {})
})
