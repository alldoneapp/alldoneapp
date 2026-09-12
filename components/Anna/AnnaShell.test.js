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

const mockUpdate = jest.fn().mockResolvedValue(undefined)
const mockUser = { uid: 'u1', gold: 100, displayName: 'Test user' }
const mockAssistant = { uid: 'a1', displayName: 'Anna Alldone' }
let mockUnmounts = 0
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: mockUser, defaultAssistant: mockAssistant }),
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
            Talk with Anna
        </button>
    ),
}))
jest.mock('../UIComponents/VoiceMicrophoneStatus', () => ({ __esModule: true, default: () => null }))
jest.mock('../../utils/backends/firestore', () => ({ getDb: () => ({ doc: () => ({ update: mockUpdate }) }) }))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { createNavigationProp: () => ({}) } }))
jest.mock('../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('../../redux/actions', () => ({ showGlobalSearchPopup: () => ({ type: 'SEARCH' }) }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text, useTranslator: () => {} }))

const conversation = { id: 'anna_u1', projectId: 'p1', assistantId: 'a1' }
const state = { conversation, loading: false, error: '', retry: jest.fn() }
const content = id => (
    <AnnaShell routeId={id}>
        <input aria-label="Real workspace editor" defaultValue="Unsaved note" />
    </AnnaShell>
)

beforeEach(() => {
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
    const voice = screen.getByText('Talk with Anna')
    expect(voice.getAttribute('data-chat')).toBe('anna_u1')
    expect(voice.getAttribute('data-project')).toBe('p1')
    await act(async () => {})
})

it('preserves the mounted workspace while returning to the portrait', async () => {
    const view = render(content(1))
    view.rerender(content(2))
    fireEvent.change(screen.getByLabelText('Real workspace editor'), { target: { value: 'Work in progress' } })
    fireEvent.click(screen.getByText('← Back to Anna'))
    expect(screen.getByLabelText('Real workspace editor').value).toBe('Work in progress')
    expect(document.querySelector('.anna-workspace').style.display).toBe('none')
    await act(async () => {})
})

it('holds assistant navigation while a workspace is pinned, until Open is clicked', async () => {
    const view = render(content(1))
    view.rerender(content(2))
    fireEvent.click(screen.getByText('Keep open'))
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
