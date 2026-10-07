import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaConversation from './AnnaConversation'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

const mockContextUpdate = jest.fn().mockResolvedValue(undefined)
jest.mock('../../hooks/Chats/useGetMessages', () => () => Object.assign([], { loaded: true }))
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
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
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
    createObjectMessage.mockResolvedValue('m1')
    runHttpsCallableFunction.mockResolvedValue({})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('saves the visible context and one project conversation message before invoking the existing assistant', async () => {
    render()
    await click('Show me my tasks')
    await submit()
    expect(mockContextUpdate).toHaveBeenCalledWith({ annaPageContext: { path: '/', title: 'Anna' } })
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

it('prevents concurrent text execution during a voice call', async () => {
    render({ call: { status: 'active' } })
    await click('Find a note')
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(container.querySelector('textarea').disabled).toBe(true)
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
