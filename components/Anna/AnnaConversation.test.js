import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaConversation from './AnnaConversation'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

const mockContextUpdate = jest.fn().mockResolvedValue(undefined)
let mockMessages = []
jest.mock('../../hooks/Chats/useGetMessages', () => () => Object.assign([...mockMessages], { loaded: true }))
jest.mock('../ChatsView/ChatDV/EditorView/MessageItemBody', () => () => null)
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 'stayward' }))
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({ doc: () => ({ update: mockContextUpdate }) }),
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../../utils/assistantHelper', () => ({ CHAT_INPUT_LIMIT_IN_CHARACTERS: 10000 }))
jest.mock('../ChatsView/Utils/ChatHelper', () => ({ getTimestampInMilliseconds: value => value }))
jest.mock('../ChatsView/ChatDV/EditorView/messageLoadingState', () => ({ resolveEffectiveMessageLoading: () => false }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? ''),
}))
jest.mock('./useAnnaMessageReadState', () => jest.fn())
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: id => ({ uid: id, displayName: id }),
}))
let root, container
const render = (overrides = {}) =>
    act(() =>
        root.render(
            <AnnaConversation
                conversation={{ projectId: 'p1', id: 'anna_u1', assistantId: 'a1' }}
                assistant={{ displayName: 'Existing assistant' }}
                user={{ uid: 'u1', gold: 100 }}
                call={{ status: 'idle' }}
                onExpand={() => {}}
                {...overrides}
            />
        )
    )
const click = text =>
    act(async () => [...container.querySelectorAll('button')].find(node => node.textContent === text).click())
const submit = () =>
    act(async () =>
        container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    mockMessages = []
    createObjectMessage.mockResolvedValue('m1')
    runHttpsCallableFunction.mockResolvedValue({})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.restoreAllMocks()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('adds one chat hint per context change without posting a message or starting an assistant run', () => {
    const tasks = { surface: 'alldone', path: '/tasks', title: 'Alldone.app - Tasks' }
    render({ pageContext: tasks })
    render({ pageContext: { ...tasks } })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    expect(container.querySelector('.anna-context-notice').textContent).toContain('Looking at: Tasks')
    render({ pageContext: { ...tasks, path: '/other-project/tasks' } })
    render({ pageContext: { surface: 'browser', path: 'https://example.com', title: 'Example' } })
    render({ pageContext: tasks })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(4)
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('places context changes between messages chronologically', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    render({ pageContext: { surface: 'alldone', path: '/tasks', title: 'Tasks' } })
    mockMessages = [{ id: 'm1', creatorId: 'u1', created: 2000, commentText: 'Open a note' }]
    now.mockReturnValue(3000)
    render({ pageContext: { surface: 'alldone', path: '/notes', title: 'Notes' } })
    const entries = [...container.querySelectorAll('.anna-context-notice, [data-anna-message-id]')]
    expect(entries.map(node => node.dataset.annaMessageId || node.querySelector('span').textContent)).toEqual([
        'Looking at: Tasks',
        'm1',
        'Looking at: Notes',
    ])
})

it('keeps context hints scoped to the account and daily conversation', () => {
    const pageContext = { surface: 'alldone', path: '/tasks', title: 'Tasks' }
    render({ pageContext })
    render({ pageContext: null })
    render({ pageContext })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    render({ pageContext, conversation: { projectId: 'p1', id: 'tomorrow', assistantId: 'a1' } })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    render({ pageContext: null, user: { uid: 'other', gold: 100 } })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(0)
})

it('saves the visible context and one project conversation message before invoking the existing assistant', async () => {
    render()
    await click('Show me my tasks')
    await submit()
    expect(mockContextUpdate).toHaveBeenCalledWith({ annaPageContext: { path: '/', title: 'Existing assistant' } })
    expect(createObjectMessage).toHaveBeenCalledWith(
        'p1',
        'anna_u1',
        'Show me my tasks',
        'topics',
        'stayward',
        null,
        null,
        true,
        true,
        'a1'
    )
    expect(mockContextUpdate.mock.invocationCallOrder[0]).toBeLessThan(createObjectMessage.mock.invocationCallOrder[0])
    expect(runHttpsCallableFunction).toHaveBeenCalledWith(
        'askToBotSecondGen',
        expect.objectContaining({ messageId: 'm1', assistantId: 'a1', isPublicFor: [0] }),
        { timeout: 3600000 }
    )
})

it('uses the selected assistant name in the welcome text, composer and Gold message', async () => {
    render({ assistant: { displayName: 'Carl Code Mentor' }, user: { uid: 'u1', gold: 0 } })
    const composer = container.querySelector('textarea')
    expect(composer.getAttribute('aria-label')).toBe('Message Carl Code Mentor')
    expect(composer.placeholder).toBe('Talk or type to Carl Code Mentor…')
    expect(container.querySelector('.anna-welcome').textContent).toContain('Talk with Carl Code Mentor.')
    await click('Show me my tasks')
    await submit()
    expect(container.querySelector('[role="alert"]').textContent).toBe('You need Gold to talk with Carl Code Mentor.')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('retries a failed assistant request using the saved message without posting a duplicate', async () => {
    runHttpsCallableFunction.mockRejectedValueOnce(new Error('Connection interrupted'))
    render()
    await click('Show me my tasks')
    await submit()
    expect(container.querySelector('[role="alert"]').textContent).toContain('Connection interrupted')
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    expect(runHttpsCallableFunction.mock.calls[1][1].messageId).toBe('m1')
    expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('preserves an unsaved draft when persistence fails', async () => {
    createObjectMessage.mockRejectedValueOnce(new Error('Offline'))
    render()
    await click('Find a note')
    await submit()
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('returns control before posting and executing a new message', async () => {
    let release
    const onBeforeSend = jest.fn(
        () =>
            new Promise(resolve => {
                release = resolve
            })
    )
    render({ onBeforeSend })
    await click('Find a note')
    await submit()
    expect(onBeforeSend).toHaveBeenCalledTimes(1)
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await act(async () => release())
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
})

it('preserves the draft and sends nothing when returning control fails', async () => {
    const onBeforeSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('Could not return control'))
        .mockResolvedValue(undefined)
    render({ onBeforeSend })
    await click('Find a note')
    await submit()
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(container.querySelector('[role="alert"]').textContent).toContain('Could not return control')
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await submit()
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
})

it('prevents concurrent text execution during a voice call', async () => {
    render({ call: { status: 'active' } })
    await click('Find a note')
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(container.querySelector('textarea').disabled).toBe(true)
})

it('starts voice in the current conversation without sending or clearing the draft', async () => {
    const startCall = jest.fn()
    render({ call: { status: 'idle', startCall } })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).toHaveBeenCalledWith({
        assistant: { uid: 'a1', displayName: 'Existing assistant' },
        projectId: 'p1',
        chatId: 'anna_u1',
        skipNavigationOnThreadCreate: true,
    })
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('keeps cancel, hangup and audio recovery available inside the composer without submitting a message', async () => {
    const endCall = jest.fn()
    const playCallAudio = jest.fn()
    render({ call: { status: 'connecting', endCall } })
    await act(async () => container.querySelector('[aria-label="Cancel call"]').click())
    expect(endCall).toHaveBeenCalledTimes(1)
    render({ call: { status: 'active', endCall, needsAudioPlayback: true, playCallAudio } })
    await act(async () => container.querySelector('[aria-label="Enable call audio"]').click())
    expect(playCallAudio).toHaveBeenCalledTimes(1)
    await act(async () => container.querySelector('[aria-label="End call"]').click())
    expect(endCall).toHaveBeenCalledTimes(2)
    render({ call: { status: 'ending', endCall } })
    expect(container.querySelector('[aria-label="End call"]').disabled).toBe(true)
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('resolves the new local day before sending while preserving retries on their original thread', async () => {
    const resolveConversation = jest
        .fn()
        .mockResolvedValue({ projectId: 'p2', id: 'AnnaChat20261008u1', assistantId: 'a2', isPublicFor: [0] })
    runHttpsCallableFunction.mockRejectedValueOnce(new Error('Offline'))
    render({ resolveConversation })
    await click('Find a note')
    await submit()
    render({ resolveConversation, conversation: { projectId: 'p3', id: 'AnnaChat20261009u1', assistantId: 'a3' } })
    await click('Retry')
    expect(resolveConversation).toHaveBeenCalledTimes(1)
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].objectId)).toEqual([
        'AnnaChat20261008u1',
        'AnnaChat20261008u1',
    ])
    expect(runHttpsCallableFunction.mock.calls[1][1].projectId).toBe('p2')
})

it('resumes a paused request after hand-back without replacing an unsent draft', async () => {
    render()
    await click('Find a note')
    const onResumeHandled = jest.fn()
    await act(async () =>
        render({
            resumeRequest: {
                id: 'resume1',
                text: 'I have returned control. Continue.',
                thread: { projectId: 'p1', id: 'anna_u1', assistantId: 'a1' },
            },
            onResumeHandled,
        })
    )
    expect(createObjectMessage).toHaveBeenCalledWith(
        'p1',
        'anna_u1',
        'I have returned control. Continue.',
        'topics',
        'stayward',
        null,
        null,
        true,
        true,
        'a1'
    )
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(onResumeHandled).toHaveBeenCalledWith('resume1')
})
