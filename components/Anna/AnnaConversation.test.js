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

it('saves the visible context and one private message before invoking the existing assistant', async () => {
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
        expect.objectContaining({ messageId: 'm1', assistantId: 'a1', isPublicFor: ['u1'] }),
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
