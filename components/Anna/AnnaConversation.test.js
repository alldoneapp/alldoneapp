import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaConversation from './AnnaConversation'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { getId, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'
import { setAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
jest.mock('../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
let mockActivityState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockActivityState) }))

// Keep the real Anna composer and send lifecycle; model the shared Quill input
// as a textarea here. Real embed insertion is exercised by the browser harness.
let mockRichInputProps
jest.mock('react-quill-new', () => ({ Quill: { import: () => require('quill-delta').default } }))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({ TASK_THEME: 'task' }))
jest.mock('../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const Delta = require('quill-delta').default
    return React.forwardRef((props, ref) => {
        mockRichInputProps = props
        const node = React.useRef(null)
        const [text, setText] = React.useState(props.initialTextExtended || '')
        const current = React.useRef(props)
        current.current = props
        const change = value => {
            node.current.value = value
            setText(value)
            current.current.onChangeText(value)
        }
        React.useImperativeHandle(ref, () => ({
            focus: () => node.current.focus(),
            clear: () => change(''),
            clearAndSetContent: change,
        }))
        React.useLayoutEffect(() => {
            props.setEditor({
                root: node.current,
                getSelection: () => ({
                    index: node.current.selectionStart,
                    length: node.current.selectionEnd - node.current.selectionStart,
                }),
                getText: (index, length) => (node.current.value + '\n').slice(index, index + length),
                getLength: () => node.current.value.length + 1,
                updateContents: delta =>
                    change(
                        new Delta()
                            .insert(node.current.value)
                            .compose(delta)
                            .ops.map(op => op.insert)
                            .join('')
                    ),
                setSelection: index => {
                    node.current.focus()
                    node.current.setSelectionRange(index, index)
                },
            })
        }, [])
        return (
            <textarea
                ref={node}
                value={text}
                placeholder={props.placeholder}
                disabled={props.disabledEdition}
                onChange={event => change(event.target.value)}
            />
        )
    })
})

let mockDictation
let mockDictationSupported = true
jest.mock('../../hooks/useRambleRecorder', () => ({ isDictationSupported: () => mockDictationSupported }))
jest.mock('../UIControls/RambleButton', () => ({
    __esModule: true,
    RAMBLE_PHASE_IDLE: 'idle',
    default: props => {
        mockDictation = props
        return <button type="button" aria-label="Dictate" />
    },
}))
const mockContextUpdate = jest.fn().mockResolvedValue(undefined)
let mockMessages = []
const mockThreadMessages = {}
jest.mock(
    '../../hooks/Chats/useGetMessages',
    () => (_a, _b, _projectId, chatId, _type, limit) =>
        Object.assign((mockThreadMessages[chatId] || mockMessages).slice(-limit), { loaded: true })
)
const mockMessageRender = jest.fn()
jest.mock('../ChatsView/ChatDV/EditorView/MessageItemBody', () => props => {
    mockMessageRender(props.messageId)
    return <div>{props.commentText}</div>
})
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../../utils/backends/Chats/commentOutbox', () => ({
    commentOutbox: { retry: jest.fn(), read: jest.fn() },
}))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 'stayward' }))
jest.mock('../../utils/backends/firestore', () => ({
    getId: jest.fn(() => 'm1'),
    getDb: () => ({ doc: () => ({ update: mockContextUpdate }) }),
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../../utils/assistantHelper', () => ({ CHAT_INPUT_LIMIT_IN_CHARACTERS: 10000 }))
jest.mock('../ChatsView/Utils/ChatHelper', () => ({ getTimestampInMilliseconds: value => value }))
let mockWorkingTemplate = '%{assistantName} is working…'
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) =>
        (text === '%{assistantName} is working…' ? mockWorkingTemplate : text).replace(
            /%{(\w+)}/g,
            (_, key) => values[key] ?? ''
        ),
}))
jest.mock('./useAnnaMessageReadState', () => jest.fn())
const mockCreators = {}
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: id => mockCreators[id] || { uid: id, displayName: id },
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
const type = value =>
    act(() => {
        const input = container.querySelector('textarea')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
beforeEach(() => {
    mockActivityState = {
        loggedUser: { uid: 'u1' },
        loggedUserProjects: [{ id: 'p1', name: 'Launch' }],
        followedFeedsData: {},
        projectChatNotifications: {},
    }
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    let messageSequence = 0
    getId.mockImplementation(() => `m${++messageSequence}`)
    localStorage.clear()
    mockDictation = null
    mockDictationSupported = true
    mockMessages = []
    mockWorkingTemplate = '%{assistantName} is working…'
    Object.keys(mockThreadMessages).forEach(key => delete mockThreadMessages[key])
    Object.keys(mockCreators).forEach(key => delete mockCreators[key])
    createObjectMessage.mockResolvedValue('m1')
    runHttpsCallableFunction.mockResolvedValue({})
    commentOutbox.retry.mockResolvedValue(undefined)
    commentOutbox.read.mockReturnValue(null)
    setAnnaWorkspaceContext(null)
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

it.each([
    'https://alldone.app/projects/p1/tasks/task-1/properties',
    'https://alldone.app/projects/p1/goals/goal-1/properties',
    'https://alldone.app/projects/p2/notes/note-1/editor',
    'https://alldone.app/projects/p1/chats/chat-1/chat',
    '@KarlM2mVOSjAVPPKweLContact#contact-1',
    '@CarlM2mVOSjAVPPKweLCode#assistant-2',
])('preserves the serialized reference through send and retry: %s', async reference => {
    runHttpsCallableFunction.mockRejectedValueOnce(new Error('Try again'))
    render()
    type(`Please review ${reference}`)
    await submit()
    expect(createObjectMessage.mock.calls[0][2]).toBe(`Please review ${reference}`)
    expect(createObjectMessage.mock.calls[0][9]).toBe('a1')
    expect(runHttpsCallableFunction.mock.calls[0][1].assistantId).toBe('a1')
    expect(container.querySelector('textarea').value).toBe('')
    type('My next draft')
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    expect(container.querySelector('textarea').value).toBe('My next draft')
})

it('selects a mention with Enter without submitting and sends only after the picker closes', async () => {
    render()
    type('@task')
    mockRichInputProps.setMentionsModalActive(true)
    const enter = () =>
        container
            .querySelector('textarea')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await act(async () => enter())
    expect(createObjectMessage).not.toHaveBeenCalled()
    type('https://alldone.app/projects/p1/tasks/task-1/properties')
    mockRichInputProps.setMentionsModalActive(false)
    await act(async () => enter())
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelector('textarea').value).toBe('')
})

it('inserts dictation at the selection and leaves it in the composer for review', async () => {
    render()
    type('Please replace this tomorrow.')
    const input = container.querySelector('textarea')
    act(() => {
        input.focus()
        input.setSelectionRange(7, 19)
        container.querySelector('[aria-label="Dictate"]').focus()
        mockDictation.onTextReady('create a task')
    })
    expect(mockDictation.projectId).toBe('p1')
    expect(mockDictation.targetKind).toBe('generic')
    expect(mockDictation.onSubmit).toBeUndefined()
    expect(input.value).toBe('Please create a task tomorrow.')
    expect(input.selectionStart).toBe(20)
    expect(document.activeElement).toBe(input)
    expect(createObjectMessage).not.toHaveBeenCalled()
    await submit()
    expect(createObjectMessage.mock.calls[0][2]).toBe('Please create a task tomorrow.')
})

it('preserves text typed while transcription runs and prevents competing calls or partial sends', async () => {
    const startCall = jest.fn()
    render({ call: { status: 'idle', startCall } })
    type('First draft')
    const pendingResult = mockDictation.onTextReady
    act(() => mockDictation.onPhaseChange('recording'))
    const phone = container.querySelector('[aria-label="Talk with Existing assistant"]')
    expect(phone.disabled).toBe(true)
    expect(container.querySelector('[aria-label="Send message"]').disabled).toBe(true)
    act(() => mockDictation.onPhaseChange('processing'))
    type('Updated draft: ')
    expect(mockDictation.getCurrentText()).toBe('Updated draft: ')
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    act(() => {
        pendingResult('Remember the meeting.')
        mockDictation.onPhaseChange('idle')
    })
    expect(container.querySelector('textarea').value).toBe('Updated draft: Remember the meeting.')
    expect(phone.disabled).toBe(false)
    expect(startCall).not.toHaveBeenCalled()
})

it('keeps dictation available while the assistant is answering another message', async () => {
    const pending = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(pending.promise)
    render()
    type('First message')
    await submit()
    expect(container.querySelector('[aria-label="Dictate"]')).not.toBeNull()
    act(() => mockDictation.onTextReady('Second message'))
    expect(container.querySelector('textarea').value).toBe('Second message')
    await act(async () => pending.resolve({}))
})

it('keeps workspace focus when a transcript arrives and does not expand a hidden chat', () => {
    const onExpand = jest.fn()
    render({ onExpand })
    const input = container.querySelector('textarea')
    const pendingResult = mockDictation.onTextReady
    render({ visible: false, onExpand })
    act(() => pendingResult('A saved draft'))
    expect(input.value).toBe('A saved draft')
    expect(document.activeElement).not.toBe(input)
    expect(onExpand).not.toHaveBeenCalled()
})

it('ignores empty dictation and hides the microphone during calls or without browser support', () => {
    render()
    type('Keep this draft')
    act(() => mockDictation.onTextReady('   \n'))
    expect(container.querySelector('textarea').value).toBe('Keep this draft')
    render({ call: { status: 'active' } })
    expect(container.querySelector('[aria-label="Dictate"]')).toBeNull()
    mockDictationSupported = false
    render()
    expect(container.querySelector('[aria-label="Dictate"]')).toBeNull()
    expect(container.querySelector('textarea').disabled).toBe(false)
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

it('shows linked red activity between messages without posting to the assistant', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    render()
    mockMessages = [{ id: 'm1', creatorId: 'u1', created: 1500, commentText: 'Working here' }]
    now.mockReturnValue(2000)
    mockActivityState.followedFeedsAmount = 1
    mockActivityState.followedFeedsData = {
        p1: [{ id: 'feed1', objectId: 'task1', objectTypes: 'tasks', lastChangeDate: 1900, entryText: 'created task' }],
    }
    mockActivityState.projectChatNotifications = {
        p1: {
            totalFollowed: 1,
            otherChat: { totalFollowed: 1, followedNotifications: [{ commentId: 'message1', date: 1950 }] },
        },
    }
    render()
    const links = [...container.querySelectorAll('.anna-activity-notice a')]
    expect(links.map(link => link.getAttribute('href'))).toEqual([
        '/projects/p1/user/u1/updates/followed',
        '/projects/p1/user/u1/chats/followed',
    ])
    expect(links[0].textContent).toContain('New update: created task · Launch')
    expect(links[1].textContent).toContain('New chat message · Launch')
    expect(container.querySelector('.anna-messages').textContent.indexOf('Working here')).toBeLessThan(
        container.querySelector('.anna-messages').textContent.indexOf('New update')
    )
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    now.mockRestore()
})

it('uses the user date/time setting for messages and every notice, including changes while chat is open', () => {
    const timestamp = new Date(2026, 9, 12, 13, 7).getTime()
    const now = jest.spyOn(Date, 'now').mockReturnValue(timestamp)
    // An American browser preference must not override the saved Alldone setting.
    jest.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('01:07 PM')
    mockMessages = [
        { id: 'user', creatorId: 'u1', created: timestamp, commentText: 'Hello' },
        { id: 'assistant', creatorId: 'a1', created: timestamp, commentText: 'Hi' },
    ]
    const pageContext = { surface: 'alldone', path: '/tasks', title: 'Alldone.app - Tasks' }
    render({ pageContext })
    now.mockReturnValue(timestamp + 1000)
    mockActivityState.followedFeedsAmount = 1
    mockActivityState.followedFeedsData = {
        p1: [{ id: 'feed', objectId: 'task', objectTypes: 'tasks', lastChangeDate: timestamp + 1000 }],
    }
    mockActivityState.projectChatNotifications = {
        p1: {
            totalFollowed: 1,
            otherChat: { totalFollowed: 1, followedNotifications: [{ commentId: 'message', date: timestamp + 1000 }] },
        },
    }
    for (const [dateFormat, expected] of [
        [undefined, '13:07'],
        ['MM.DD.YYYY', '01:07 pm'],
        ['DD.MM.YYYY', '13:07'],
    ]) {
        mockActivityState.dateFormat = dateFormat
        render({ pageContext })
        const times = [...container.querySelectorAll('time')]
        expect(times).toHaveLength(5)
        expect(times.map(node => node.textContent)).toEqual(Array(5).fill(expected))
        expect(times.every(node => Number.isFinite(Date.parse(node.dateTime)))).toBe(true)
    }
})
it('reports persisted run completion to the workspace without waiting for the spinner timeout', () => {
    const onWorkStateChange = jest.fn()
    mockMessages = [
        {
            id: 'response',
            fromAssistant: true,
            isLoading: true,
            assistantRun: { triggerMessageId: 'request', status: 'running' },
        },
    ]
    render({ onWorkStateChange })
    expect(onWorkStateChange).toHaveBeenLastCalledWith({
        projectId: 'p1',
        chatId: 'anna_u1',
        busy: true,
        completedRequests: [],
    })
    mockMessages = [
        { ...mockMessages[0], isLoading: false, assistantRun: { triggerMessageId: 'request', status: 'completed' } },
    ]
    render({ onWorkStateChange })
    expect(onWorkStateChange).toHaveBeenLastCalledWith({
        projectId: 'p1',
        chatId: 'anna_u1',
        busy: false,
        completedRequests: ['request'],
    })
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
        'a1',
        null,
        { id: 'm1', created: expect.any(Number) }
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

it('keeps failed text in its bubble and leaves the composer ready for another message', async () => {
    createObjectMessage.mockRejectedValueOnce(new Error('Offline'))
    render()
    await click('Find a note')
    await submit()
    expect(container.querySelector('textarea').value).toBe('')
    expect(container.querySelector('textarea').disabled).toBe(false)
    expect(container.querySelector('.anna-message-user').textContent).toContain('Find a note')
    expect(container.querySelector('.anna-message-user [role="alert"]').textContent).toContain('Offline')
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

it('keeps a failed control handback retryable without restoring text over the next draft', async () => {
    const onBeforeSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('Could not return control'))
        .mockResolvedValue(undefined)
    render({ onBeforeSend })
    await click('Find a note')
    await submit()
    type('My next draft')
    expect(container.querySelector('.anna-message-user').textContent).toContain('Find a note')
    expect(container.querySelector('[role="alert"]').textContent).toContain('Could not return control')
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelector('textarea').value).toBe('My next draft')
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
        'a1',
        null,
        { id: 'm1', created: expect.any(Number) }
    )
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(onResumeHandled).toHaveBeenCalledWith('resume1')
})

it('resolves the authoritative thread before starting voice and keeps the draft intact', async () => {
    let finish
    const startCall = jest.fn()
    const resolveConversation = jest.fn(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    render({ call: { status: 'idle', startCall }, resolveConversation })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Cancel call"]')).not.toBeNull()
    await act(async () => finish({ projectId: 'p2', id: 'today', assistantId: 'a2' }))
    expect(startCall).toHaveBeenCalledWith(
        expect.objectContaining({
            projectId: 'p2',
            chatId: 'today',
            assistant: expect.objectContaining({ uid: 'a2' }),
        })
    )
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('cancels voice while waiting for conversation validation without starting a late call', async () => {
    let finish
    const startCall = jest.fn()
    render({
        call: { status: 'idle', startCall },
        resolveConversation: () =>
            new Promise(resolve => {
                finish = resolve
            }),
    })
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    await act(async () => container.querySelector('[aria-label="Cancel call"]').click())
    await act(async () => finish({ projectId: 'p1', id: 'today', assistantId: 'a1' }))
    expect(startCall).not.toHaveBeenCalled()
    expect(container.querySelector('textarea').disabled).toBe(false)
})

it('keeps the draft and reports a failed voice target lookup', async () => {
    const startCall = jest.fn()
    render({
        call: { status: 'idle', startCall },
        resolveConversation: async () => {
            throw new Error('Offline')
        },
    })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(container.querySelector('[role="alert"]').textContent).toBe('Offline')
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(startCall).not.toHaveBeenCalled()
})

it('shows text and frees the focused composer before conversation resolution completes', async () => {
    const resolution = deferred()
    const resolveConversation = jest.fn(() => resolution.promise)
    render({ resolveConversation })
    type('First message')
    await submit()
    const input = container.querySelector('textarea')
    expect(container.querySelector('.anna-message-user').textContent).toContain('First message')
    expect(input.value).toBe('')
    expect(input.disabled).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(createObjectMessage).not.toHaveBeenCalled()
    type('Next draft')
    await act(async () => resolution.resolve({ projectId: 'p1', id: 'today', assistantId: 'a1' }))
    expect(input.value).toBe('Next draft')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
    expect(container.querySelector('.anna-message-user').dataset.annaChatId).toBe('today')
})

it('sends two messages while the first assistant run is pending and keeps aggregate busy state', async () => {
    const first = deferred()
    const second = deferred()
    const onSendingChange = jest.fn()
    createObjectMessage.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    getId.mockReturnValueOnce('first').mockReturnValueOnce('second')
    runHttpsCallableFunction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render({ onSendingChange })
    type('One')
    await submit()
    type('Two')
    await submit()
    type('Still writing a third')
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(2)
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].messageId)).toEqual(['first', 'second'])
    expect(container.querySelector('textarea').disabled).toBe(false)
    expect(onSendingChange).toHaveBeenLastCalledWith(true)
    await act(async () => second.resolve({}))
    expect(onSendingChange).toHaveBeenLastCalledWith(true)
    await act(async () => first.resolve({}))
    expect(onSendingChange).toHaveBeenLastCalledWith(false)
    expect(container.querySelector('textarea').value).toBe('Still writing a third')
})

it('uses the final body renderer and keeps the message node through pending, persisted and acknowledged states', async () => {
    const preparation = deferred()
    const response = deferred()
    const onBeforeSend = () => preparation.promise
    runHttpsCallableFunction.mockReturnValueOnce(response.promise)
    render({ onBeforeSend })
    type('# Heading\n**Bold** and https://example.com')
    await submit()
    const messageNode = container.querySelector('.anna-message-user')
    const bodyNode = messageNode.children[1]
    expect(messageNode.dataset.annaMessageId).toBe('m1')
    expect(mockMessageRender).toHaveBeenCalledWith('m1')
    expect(container.querySelector('.anna-message-text')).toBeNull()
    await act(async () => preparation.resolve())
    expect(createObjectMessage.mock.calls[0][11]).toMatchObject({ id: 'm1', created: expect.any(Number) })
    expect(container.querySelector('.anna-message-user')).toBe(messageNode)
    expect(messageNode.children[1]).toBe(bodyNode)
    mockMessages = [
        {
            id: 'm1',
            creatorId: 'u1',
            created: createObjectMessage.mock.calls[0][11].created,
            commentText: '# Heading\n**Bold** and https://example.com',
        },
    ]
    render({ onBeforeSend })
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
    expect(container.querySelector('.anna-message-user')).toBe(messageNode)
    await act(async () => response.resolve({}))
    expect(container.querySelector('.anna-message-user')).toBe(messageNode)
    expect(messageNode.children[1]).toBe(bodyNode)
})

it('does not duplicate the draft on two submit events in the same frame', async () => {
    render()
    type('One click')
    await act(async () => {
        const form = container.querySelector('form')
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
})

it('waits for the durable outbox delivery before starting the assistant and retries the same ID', async () => {
    const delivery = deferred()
    commentOutbox.retry.mockReturnValueOnce(delivery.promise)
    render()
    type('Important message')
    await submit()
    type('Do not overwrite this')
    expect(commentOutbox.retry).toHaveBeenCalledWith('u1', 'm1')
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await act(async () => delivery.reject(new Error('Network interrupted')))
    expect(container.querySelector('.anna-message-user [role="alert"]').textContent).toContain('Network interrupted')
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    expect(container.querySelector('textarea').value).toBe('Do not overwrite this')
})

it('does not treat an offline outbox entry as a delivered message', async () => {
    commentOutbox.read.mockReturnValue({ id: 'm1', status: 'pending' })
    render()
    type('Offline message')
    await submit()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
    expect(container.querySelector('.anna-message-user [role="alert"]')).not.toBeNull()
    commentOutbox.read.mockReturnValue(null)
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
})

it('merges the Firestore echo with the local message while preserving an assistant failure and retry', async () => {
    const response = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(response.promise)
    render()
    type('One visible copy')
    await submit()
    mockMessages = [{ id: 'm1', creatorId: 'u1', created: Date.now(), commentText: 'One visible copy' }]
    render()
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
    await act(async () => response.reject(new Error('Assistant interrupted')))
    expect(container.querySelector('.anna-message-user [role="alert"]').textContent).toContain('Assistant interrupted')
    type('Later draft')
    await click('Retry')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('textarea').value).toBe('Later draft')
})

it('uses the context at submission time even when preparation is delayed', async () => {
    const resolution = deferred()
    const resolveConversation = () => resolution.promise
    setAnnaWorkspaceContext({ path: '/notes/original', title: 'Original note' })
    render({ resolveConversation })
    type('Summarize this')
    await submit()
    setAnnaWorkspaceContext({ path: '/tasks/other', title: 'Other task' })
    await act(async () => resolution.resolve({ projectId: 'p1', id: 'anna_u1', assistantId: 'a1' }))
    expect(mockContextUpdate).toHaveBeenCalledWith({
        annaPageContext: { path: '/notes/original', title: 'Original note' },
    })
})

it('hides pending text and stops dispatch after an account change', async () => {
    const resolution = deferred()
    const resolveConversation = () => resolution.promise
    render({ resolveConversation })
    type('Private message')
    await submit()
    render({ resolveConversation, user: { uid: 'another-user', gold: 100 } })
    expect(container.querySelectorAll('.anna-message-user')).toHaveLength(0)
    await act(async () => resolution.resolve({ projectId: 'p1', id: 'anna_u1', assistantId: 'a1' }))
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('keeps the failed bubble visible when conversation resolution returns no target, then resolves again on retry', async () => {
    const resolveConversation = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ projectId: 'p1', id: 'today', assistantId: 'a1' })
    render({ resolveConversation })
    type('Keep this message')
    await submit()
    expect(container.querySelector('.anna-message-user').textContent).toContain('Keep this message')
    expect(container.querySelector('.anna-message-user [role="alert"]')).not.toBeNull()
    expect(createObjectMessage).not.toHaveBeenCalled()
    await click('Retry')
    expect(resolveConversation).toHaveBeenCalledTimes(2)
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.anna-message-user').dataset.annaChatId).toBe('today')
})

it('clears shell busy state on unmount and does not dispatch after delayed preparation', async () => {
    const resolution = deferred()
    const onSendingChange = jest.fn()
    render({ resolveConversation: () => resolution.promise, onSendingChange })
    type('Pending message')
    await submit()
    expect(onSendingChange).toHaveBeenLastCalledWith(true)
    act(() => root.render(null))
    expect(onSendingChange).toHaveBeenLastCalledWith(false)
    await act(async () => resolution.resolve({ projectId: 'p1', id: 'today', assistantId: 'a1' }))
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('automatically releases the workspace before starting a voice request', async () => {
    const handback = deferred()
    const onBeforeSend = jest.fn(() => handback.promise)
    const startCall = jest.fn()
    render({ onBeforeSend, call: { status: 'idle', startCall } })
    type('Preserve my text draft')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(onBeforeSend).toHaveBeenCalledTimes(1)
    expect(startCall).not.toHaveBeenCalled()
    await act(async () => handback.resolve())
    expect(startCall).toHaveBeenCalledTimes(1)
    expect(container.querySelector('textarea').value).toBe('Preserve my text draft')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('keeps voice from starting if automatic handback fails or preparation is cancelled', async () => {
    const handback = deferred()
    const startCall = jest.fn()
    const onBeforeSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('Workspace unavailable'))
        .mockReturnValueOnce(handback.promise)
    render({ onBeforeSend, call: { status: 'idle', startCall } })
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]').textContent).toContain('Workspace unavailable')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    await act(async () => container.querySelector('[aria-label="Cancel call"]').click())
    await act(async () => handback.resolve())
    expect(startCall).not.toHaveBeenCalled()
})

it('keeps an offline draft across remounts and sends it only after reconnecting', async () => {
    const startCall = jest.fn()
    render({ offline: true, call: { status: 'idle', startCall } })
    type('Remember this when I reconnect')
    expect(container.querySelector('[aria-label="Send message"]').disabled).toBe(true)
    expect(container.querySelector('[aria-label="Talk with Existing assistant"]').disabled).toBe(true)
    expect(container.querySelector('[aria-label="Dictate"]')).toBeNull()
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    act(() => root.unmount())
    root = createRoot(container)
    render({ offline: true })
    expect(container.querySelector('textarea').value).toBe('Remember this when I reconnect')
    render({ offline: false })
    expect(createObjectMessage).not.toHaveBeenCalled()
    await submit()
    expect(createObjectMessage.mock.calls[0][2]).toBe('Remember this when I reconnect')
    act(() => root.unmount())
    root = createRoot(container)
    render()
    expect(container.querySelector('textarea').value).toBe('')
})

it('does not restore another account or default project draft', () => {
    render()
    type('Private draft')
    act(() => root.unmount())
    root = createRoot(container)
    render({ user: { uid: 'u2', gold: 100 } })
    expect(container.querySelector('textarea').value).toBe('')
    act(() => root.unmount())
    root = createRoot(container)
    render({ user: { uid: 'u1', gold: 100, defaultProjectId: 'p2' } })
    expect(container.querySelector('textarea').value).toBe('')
})

it('shows the latest 50 messages per thread and expands only the requested thread', async () => {
    const threads = ['day1', 'day2', 'anna_u1'].map(chatId => ({ projectId: 'p1', chatId }))
    for (const { chatId } of threads) {
        mockThreadMessages[chatId] = Array.from({ length: 101 }, (_, index) => ({
            id: `${chatId}-${index}`,
            creatorId: 'a1',
            commentText: `Previous message ${index}`,
            created: index + 1,
        }))
    }
    render({ threads })
    const messageIds = chatId =>
        [...container.querySelectorAll(`[data-anna-chat-id="${chatId}"]`)].map(node => node.dataset.annaMessageId)
    for (const { chatId } of threads) {
        expect(messageIds(chatId)).toEqual(mockThreadMessages[chatId].slice(-50).map(message => message.id))
    }
    await click('Earlier messages')
    expect(messageIds('day1')).toEqual(mockThreadMessages.day1.slice(-100).map(message => message.id))
    expect(messageIds('day2')).toHaveLength(50)
    expect(messageIds('anna_u1')).toHaveLength(50)
})

it('keeps typing out of the transcript render and synchronous storage paths', () => {
    mockMessages = Array.from({ length: 50 }, (_, i) => ({
        id: `message-${i}`,
        creatorId: 'a1',
        commentText: `Previous message ${i}`,
        created: i + 1,
    }))
    render()
    type('H')
    mockMessageRender.mockClear()
    const writes = jest.spyOn(Storage.prototype, 'setItem')
    for (const text of ['He', 'Hel', 'Hell', 'Hello']) type(text)
    expect({ transcriptRenders: mockMessageRender.mock.calls.length, storageWrites: writes.mock.calls.length }).toEqual(
        {
            transcriptRenders: 0,
            storageWrites: 0,
        }
    )
    expect(container.querySelector('[aria-label="Send message"]').disabled).toBe(false)
})

it.each(['running', 'cancel_requested'])('hides the working line only while a %s live card is shown', async status => {
    if (status === 'cancel_requested') mockWorkingTemplate = '%{assistantName} arbeitet…'
    const workingLine = mockWorkingTemplate.replace('%{assistantName}', 'Existing assistant')
    const pending = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(pending.promise)
    mockCreators.a1 = { displayName: 'Carl', isAssistant: true, photoURL: 'carl.png' }
    render()
    type('Please help')
    await submit()
    expect(container.textContent).toContain(workingLine)
    mockMessages = [
        {
            id: 'response',
            creatorId: 'a1',
            fromAssistant: true,
            isLoading: true,
            lastChangeDate: Date.now(),
            commentText: 'Working',
            assistantRun: { kind: 'chat', status, runId: 'r1' },
        },
    ]
    render()
    expect(container.textContent).not.toContain(workingLine)
    const author = container.querySelector('[data-anna-message-id="response"] .anna-message-author')
    expect(author.firstElementChild.className).toBe('anna-message-avatar')
    expect(author.querySelector('.anna-message-author-name').textContent).toBe('Carl')
    expect(author.querySelector('.anna-message-avatar').innerHTML).toContain('carl.png')
    expect(container.querySelector('.anna-message-user .anna-message-avatar')).toBeNull()
    // A stale response no longer shows a card. Keep useful pending feedback.
    mockMessages[0].lastChangeDate = Date.now() - 6 * 60 * 1000
    render()
    expect(container.textContent).toContain(workingLine)
    await act(async () => pending.resolve({}))
})

it('also suppresses the redundant line for a live card in an earlier visible thread', async () => {
    const pending = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(pending.promise)
    mockCreators.a2 = { displayName: 'Other assistant', isAssistant: true }
    mockThreadMessages.yesterday = [
        {
            id: 'older-response',
            creatorId: 'a2',
            isLoading: true,
            lastChangeDate: Date.now(),
            assistantRun: { kind: 'chat', status: 'running' },
        },
    ]
    const threads = [
        { projectId: 'p1', chatId: 'yesterday' },
        { projectId: 'p1', chatId: 'anna_u1' },
    ]
    render({ threads })
    type('Help today')
    await submit()
    expect(container.textContent).not.toContain('is working…')
    render({ threads: [threads[1]] })
    expect(container.textContent).toContain('Existing assistant is working…')
    await act(async () => pending.resolve({}))
})

it('preserves pending, offline and VM interaction feedback without a live card', async () => {
    const pending = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(pending.promise)
    render()
    type('Please help')
    await submit()
    mockCreators.a1 = { displayName: 'Carl', isAssistant: true }
    mockMessages = [
        {
            id: 'vm',
            creatorId: 'a1',
            fromAssistant: true,
            isLoading: true,
            lastChangeDate: Date.now(),
            commentText: 'Please confirm the plan',
            assistantRun: { kind: 'vm_job', status: 'awaiting_user' },
        },
    ]
    render({ offline: true })
    expect(container.textContent).toContain('Existing assistant is working…')
    expect(container.textContent).toContain('Please confirm the plan')
    expect(container.textContent).toContain('You are offline.')
    await act(async () => pending.resolve({}))
})

it('keeps the message sending status and errors visible alongside a live card', async () => {
    const pending = deferred()
    createObjectMessage.mockReturnValueOnce(pending.promise)
    mockCreators.a1 = { displayName: 'Carl', isAssistant: true }
    mockMessages = [
        {
            id: 'response',
            creatorId: 'a1',
            isLoading: true,
            lastChangeDate: Date.now(),
            assistantRun: { kind: 'chat', status: 'running' },
        },
    ]
    render()
    type('Another message')
    await submit()
    expect(container.textContent).not.toContain('is working…')
    expect(container.querySelector('[aria-label="assistantLineSending"]')).not.toBeNull()
    await act(async () => pending.reject(new Error('Message not delivered')))
    expect(container.querySelector('[role="alert"]').textContent).toContain('Message not delivered')
})

it('uses a generic avatar for an unknown assistant and only falls back to matching selected data', () => {
    mockCreators.a1 = { isUnknownUser: true }
    mockCreators.a2 = { isUnknownUser: true }
    mockMessages = ['a1', 'a2'].map(id => ({
        id,
        creatorId: id,
        fromAssistant: true,
        created: 1000,
        commentText: 'Answer',
    }))
    render({ assistant: { uid: 'a1', displayName: 'Carl', photoURL50: 'carl.png' } })
    const matching = container.querySelector('[data-anna-message-id="a1"] .anna-message-author')
    const unknown = container.querySelector('[data-anna-message-id="a2"] .anna-message-author')
    expect(matching.textContent).toContain('Carl')
    expect(matching.innerHTML).toContain('carl.png')
    expect(unknown.textContent).toContain('Assistant')
    expect(unknown.innerHTML).not.toContain('carl.png')
    expect(unknown.querySelector('svg')).not.toBeNull()
})
