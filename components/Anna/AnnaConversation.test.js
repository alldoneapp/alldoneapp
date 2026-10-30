import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaConversation from './AnnaConversation'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { getId, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'
import { threadRunGate } from '../../utils/backends/Chats/threadRunGate'
import { setAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'
import { publishAnnaActivityContext } from './annaActivityContext'
import { updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import { insertAttachmentInsideEditor } from '../Feeds/CommentsTextInput/textInputHelper'
import { installAppResumeListener } from '../../utils/appResume'
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({
    ...jest.requireActual('../UIComponents/Ghosts/ghostAnimation'),
    useReducedMotion: () => true,
}))
jest.mock('./annaActivityContent', () => ({ loadAnnaActivityContent: jest.fn().mockResolvedValue(null) }))
jest.mock('../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
let mockActivityState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockActivityState) }))

// Keep the real Anna composer and send lifecycle; model the shared Quill input
// as a textarea here. Real embed insertion is exercised by the browser harness.
let mockRichInputProps
jest.mock('react-quill-new', () => ({ Quill: { import: () => require('quill-delta').default } }))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({
    TASK_THEME: 'task',
    NEW_ATTACHMENT: '1',
    insertAttachmentInsideEditor: jest.fn(),
}))
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
let mockAttachments
jest.mock('../Feeds/AddFeed/AddFeedAttachButton', () => props => {
    mockAttachments = props
    return <button type="button" aria-label="Select kind of file to add" disabled={props.isDisabled} />
})
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
const mockContextSet = jest.fn().mockResolvedValue(undefined)
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
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    STAYWARD_COMMENT: 'stayward',
    updateNewAttachmentsData: jest.fn(),
}))
jest.mock('../../utils/backends/firestore', () => ({
    getId: jest.fn(() => 'm1'),
    getDb: () => ({ doc: () => ({ update: mockContextUpdate, set: mockContextSet }) }),
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../../utils/assistantHelper', () => ({ CHAT_INPUT_LIMIT_IN_CHARACTERS: 10000 }))
jest.mock('../ChatsView/Utils/ChatHelper', () => ({ getTimestampInMilliseconds: value => value }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? ''),
}))
jest.mock('../ChatsView/ChatDV/EditorView/AssistantThinking3D/AssistantThinking3D', () => ({
    __esModule: true,
    default: () => null,
    useAssistantThinking3DEnabled: () => false,
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
    mockAttachments = null
    mockDictationSupported = true
    mockMessages = []
    Object.keys(mockThreadMessages).forEach(key => delete mockThreadMessages[key])
    Object.keys(mockCreators).forEach(key => delete mockCreators[key])
    createObjectMessage.mockResolvedValue('m1')
    updateNewAttachmentsData.mockImplementation(async (_projectId, text) => text)
    runHttpsCallableFunction.mockResolvedValue({})
    commentOutbox.retry.mockResolvedValue(undefined)
    commentOutbox.read.mockReturnValue(null)
    setAnnaWorkspaceContext(null)
    threadRunGate.reset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

it('returns to the latest messages on request, preserves the draft and resumes following messages', () => {
    const ref = React.createRef()
    render({ ref })
    type('Keep this draft')
    const log = container.querySelector('[role="log"]')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    log.scrollTop = 100
    act(() => log.dispatchEvent(new Event('scroll', { bubbles: true })))
    mockMessages = [{ id: 'first', creatorId: 'u1', created: 1, commentText: 'First message' }]
    render({ ref })
    expect(log.scrollTop).toBe(100)
    expect(container.querySelector('.anna-latest')).not.toBeNull()

    act(() => ref.current.scrollToLatest())
    expect(log.scrollTop).toBe(1200)
    expect(container.querySelector('.anna-latest')).toBeNull()
    expect(container.querySelector('textarea').value).toBe('Keep this draft')
    act(() => ref.current.focusInput())
    expect(document.activeElement).toBe(container.querySelector('textarea'))
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1500 })
    mockMessages = [...mockMessages, { id: 'second', creatorId: 'u1', created: 2, commentText: 'Next message' }]
    render({ ref })
    expect(log.scrollTop).toBe(1500)
})

it.each(['mode', 'pane'])('returns to the bottom on every %s activation after reading older messages', activation => {
    const ref = React.createRef()
    render({ ref })
    type('Keep my draft')
    const log = container.querySelector('[role="log"]')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    for (let cycle = 0; cycle < 3; cycle++) {
        log.scrollTop = 100
        act(() => log.dispatchEvent(new Event('scroll', { bubbles: true })))
        render({ ref, active: activation !== 'mode', visible: false })
        render({ ref, active: true, visible: true })
        expect(log.scrollTop).toBe(1200)
        expect(container.querySelector('textarea').value).toBe('Keep my draft')
        Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1500 })
        mockMessages = [{ id: `loaded-${cycle}`, creatorId: 'u1', created: 1, commentText: 'Loaded later' }]
        render({ ref })
        expect(log.scrollTop).toBe(1500)
        Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1200 })
    }
})

it('scrolls an async-mounted conversation even when the user has focused the workspace', () => {
    const workspace = document.createElement('input')
    document.body.appendChild(workspace)
    workspace.focus()
    const height = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200)
    const viewport = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    try {
        render()
        expect(container.querySelector('[role="log"]').scrollTop).toBe(1200)
        expect(document.activeElement).toBe(workspace)
    } finally {
        height.mockRestore()
        viewport.mockRestore()
        workspace.remove()
    }
})

it('follows viewport resizing after focus without pulling a reader away from older messages', () => {
    const originalObserver = global.ResizeObserver
    const observers = []
    global.ResizeObserver = class {
        constructor(callback) {
            this.callback = callback
            this.observe = jest.fn()
            this.disconnect = jest.fn()
            observers.push(this)
        }
    }
    try {
        const ref = React.createRef()
        render({ ref })
        const log = container.querySelector('[role="log"]')
        const observer = observers.find(item => item.observe.mock.calls.some(([node]) => node === log))
        expect(observer).toBeDefined()
        // Observe the content box as well: a late image can grow the content
        // while the fixed-height message viewport remains exactly the same.
        expect(observer.observe).toHaveBeenCalledWith(log.firstElementChild)
        Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1200 })
        Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
        act(() => observer.callback())
        expect(log.scrollTop).toBe(1200)
        log.scrollTop = 100
        act(() => log.dispatchEvent(new Event('scroll', { bubbles: true })))
        act(() => observer.callback())
        expect(log.scrollTop).toBe(100)
        render({ ref, visible: false })
        Object.defineProperty(log, 'clientHeight', { configurable: true, value: 0 })
        act(() => log.dispatchEvent(new Event('scroll', { bubbles: true })))
        render({ ref, visible: true })
        Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
        act(() => observer.callback())
        expect(log.scrollTop).toBe(1200)
        act(() => ref.current.scrollToLatest())
        Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1500 })
        act(() => observer.callback())
        expect(log.scrollTop).toBe(1500)
        act(() => root.unmount())
        expect(observer.disconnect).toHaveBeenCalledTimes(1)
    } finally {
        global.ResizeObserver = originalObserver
    }
})

it('places the shared attachment picker next to the microphone and inserts the selected file', () => {
    render()
    const tools = container.querySelector('.anna-composer-tools')
    expect(tools.querySelector('[aria-label="Dictate"]')).not.toBeNull()
    expect(tools.querySelector('[aria-label="Select kind of file to add"]')).not.toBeNull()
    expect(mockAttachments.compact).toBe(true)
    expect(mockAttachments.projectId).toBe('p1')
    mockAttachments.addAttachmentTag('plan.pdf', 'blob:plan')
    expect(insertAttachmentInsideEditor).toHaveBeenCalledWith(0, expect.any(Object), 'plan.pdf', 'blob:plan')
})

it.each([{ offline: true }, { conversation: { id: 'anna_u1', assistantId: 'a1' } }])(
    'disables attachments when unavailable: %j',
    props => {
        render(props)
        expect(container.querySelector('[aria-label="Select kind of file to add"]').disabled).toBe(true)
    }
)

it('disables the attachment picker during dictation', () => {
    render()
    act(() => mockDictation.onPhaseChange('recording'))
    expect(mockAttachments.isDisabled).toBe(true)
    mockAttachments.addAttachmentTag('plan.pdf', 'blob:plan')
    expect(insertAttachmentInsideEditor).not.toHaveBeenCalled()
})

const fileToken = (uri, name = 'plan.pdf', isNew = '1') =>
    `EbDsQTD14ahtSR5${uri}EbDsQTD14ahtSR5${name}EbDsQTD14ahtSR5${isNew}`

it('uploads files to the resolved conversation before saving or dispatching and keeps the next draft intact', async () => {
    const upload = deferred()
    const localText = `Review ${fileToken('blob:plan')}`
    const uploadedText = `Review ${fileToken('https://storage.example/plan.pdf', 'plan.pdf', 'false')}`
    updateNewAttachmentsData.mockReturnValueOnce(upload.promise)
    render({ resolveConversation: async () => ({ projectId: 'p2', id: 'today', assistantId: 'a2' }) })
    type(localText)
    await submit()
    expect(updateNewAttachmentsData).toHaveBeenCalledWith('p2', localText)
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    type('My next draft')
    await act(async () => upload.resolve(uploadedText))
    expect(createObjectMessage.mock.calls[0].slice(0, 3)).toEqual(['p2', 'today', uploadedText])
    expect(runHttpsCallableFunction.mock.calls[0][1].projectId).toBe('p2')
    expect(container.querySelector('textarea').value).toBe('My next draft')
})

it('retries an assistant request without uploading or saving its files again', async () => {
    const uploadedText = fileToken('https://storage.example/plan.pdf', 'plan.pdf', 'false')
    updateNewAttachmentsData.mockResolvedValueOnce(uploadedText)
    runHttpsCallableFunction.mockRejectedValueOnce(new Error('Try again'))
    render()
    type(fileToken('blob:plan'))
    await submit()
    await click('Retry')
    expect(updateNewAttachmentsData).toHaveBeenCalledTimes(1)
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(createObjectMessage.mock.calls[0][2]).toBe(uploadedText)
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    expect(runHttpsCallableFunction.mock.calls[1][1].messageId).toBe('m1')
})

it('keeps a partial upload retryable and never posts a local blob reference', async () => {
    const firstUploaded = fileToken('https://storage.example/one.pdf', 'one.pdf', 'false')
    const secondLocal = fileToken('blob:two', 'two.pdf')
    const partialText = `${firstUploaded} ${secondLocal}`
    const completeText = `${firstUploaded} ${fileToken('https://storage.example/two.pdf', 'two.pdf', 'false')}`
    updateNewAttachmentsData.mockResolvedValueOnce(partialText).mockResolvedValueOnce(completeText)
    render()
    type(`${fileToken('blob:one', 'one.pdf')} ${secondLocal}`)
    await submit()
    expect(container.textContent).toContain('Task attachment upload failed')
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(commentOutbox.retry).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    type('My next draft')
    await click('Retry')
    expect(updateNewAttachmentsData).toHaveBeenLastCalledWith('p1', partialText)
    expect(createObjectMessage.mock.calls[0][2]).toBe(completeText)
    expect(createObjectMessage.mock.calls[0][11].id).toBe('m1')
    expect(container.querySelector('textarea').value).toBe('My next draft')
})

it.each([
    'O2TI5plHBf1QfdYblob:photoO2TI5plHBf1QfdYblob:previewO2TI5plHBf1QfdYphoto.pngO2TI5plHBf1QfdY1',
    'ptPQsef7OeB5eWdblob:videoptPQsef7OeB5eWdvideo.webmptPQsef7OeB5eWd1',
])('also blocks failed image and video uploads: %s', async text => {
    render()
    type(text)
    await submit()
    expect(updateNewAttachmentsData).toHaveBeenCalledWith('p1', text)
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Task attachment upload failed')
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.restoreAllMocks()
    jest.useRealTimers()
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
    // A tap-started take never calls onSubmit; only a held one does (AT-2929).
    expect(typeof mockDictation.onSubmit).toBe('function')
    expect(input.value).toBe('Please create a task tomorrow.')
    expect(input.selectionStart).toBe(20)
    expect(document.activeElement).toBe(input)
    expect(createObjectMessage).not.toHaveBeenCalled()
    await submit()
    expect(createObjectMessage.mock.calls[0][2]).toBe('Please create a task tomorrow.')
})

it('preserves text typed while transcription runs and prevents competing calls or partial sends', async () => {
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({ call: { status: 'idle', startCall, endCall: jest.fn() } })
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

describe('hold the microphone to send (AT-2929)', () => {
    // The real RambleButton calls onTextReady and then, only for a held take, onSubmit — both
    // while its phase is still 'processing'. Model exactly that order here.
    const holdAndRelease = async transcript => {
        act(() => mockDictation.onPhaseChange('recording'))
        act(() => mockDictation.onPhaseChange('processing'))
        await act(async () => {
            mockDictation.onTextReady(transcript)
            mockDictation.onSubmit(transcript)
        })
        act(() => mockDictation.onPhaseChange('idle'))
    }

    it('sends the transcript immediately on release, without a second click', async () => {
        render()
        await holdAndRelease('Call Sam tomorrow.')
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
        expect(createObjectMessage.mock.calls[0][2]).toBe('Call Sam tomorrow.')
        const input = container.querySelector('textarea')
        expect(input.value).toBe('')
        // Sending by voice must not open the keyboard on a phone.
        expect(document.activeElement).not.toBe(input)
    })

    it('sends what was typed before together with the transcript', async () => {
        render()
        type('Please')
        await holdAndRelease('remember the meeting.')
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
        expect(createObjectMessage.mock.calls[0][2]).toBe('Please remember the meeting.')
    })

    it('sends once even if the release is reported twice', async () => {
        render()
        await holdAndRelease('Only once.')
        await act(async () => mockDictation.onSubmit('Only once.'))
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
    })

    it('never sends the typed draft when the take produced no transcript', async () => {
        render()
        type('Half-written draft')
        await holdAndRelease('   \n')
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(container.querySelector('textarea').value).toBe('Half-written draft')
    })

    it('does not let an earlier tap-started take arm a later empty hold', async () => {
        render()
        // Tap: the transcript is inserted for review and nothing is sent.
        act(() => mockDictation.onTextReady('Reviewed text'))
        expect(createObjectMessage).not.toHaveBeenCalled()
        await holdAndRelease('')
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(container.querySelector('textarea').value).toBe('Reviewed text')
    })

    it('keeps the transcript in the composer when sending is not possible', async () => {
        render({ user: { uid: 'u1', gold: 0 } })
        await holdAndRelease('No Gold left.')
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(container.querySelector('textarea').value).toBe('No Gold left.')
        expect(container.querySelector('[role="alert"]').textContent).toContain('You need Gold')
    })

    it('does not send while the selected project chat is still being resolved', async () => {
        render({ switching: true })
        await holdAndRelease('Wait for the project.')
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(container.querySelector('textarea').value).toBe('Wait for the project.')
    })
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
    expect(container.querySelector('[aria-label="Dictate"]').closest('[inert]')).not.toBeNull()
    mockDictationSupported = false
    render()
    expect(container.querySelector('[aria-label="Dictate"]')).toBeNull()
    expect(container.querySelector('textarea').disabled).toBe(false)
})

it('shows only the currently opened view, without posting a message or starting an assistant run (AT-2914)', () => {
    const tasks = { surface: 'alldone', path: '/tasks', title: 'Alldone.app - Tasks' }
    render({ pageContext: tasks })
    render({ pageContext: { ...tasks } })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    expect(container.querySelector('.anna-context-notice').textContent).toContain('Looking at: Tasks')
    render({ pageContext: { ...tasks, path: '/other-project/tasks' } })
    render({ pageContext: { surface: 'browser', path: 'https://example.com', title: 'Example' } })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    expect(container.querySelector('.anna-context-notice').textContent).toContain('Looking at: Example')
    render({ pageContext: tasks })
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(1)
    expect(container.querySelector('.anna-context-notice').textContent).toContain('Looking at: Tasks')
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('shows linked red activity between messages without posting to the assistant', () => {
    jest.useFakeTimers()
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
    act(() => jest.advanceTimersByTime(300))
    const links = [...container.querySelectorAll('.anna-activity-notice a')]
    // A task opens itself; a chat whose object type is not known yet opens its own chat object,
    // which is resolved on click — never the followed chats inbox (AT-2906).
    expect(links.map(link => link.getAttribute('href'))).toEqual([
        '/projects/p1/tasks/task1/properties',
        '/projects/p1/chats/otherChat/chat',
    ])
    expect(links[0].querySelector('.anna-activity-title').textContent).toBe('created task')
    expect(links[1].querySelector('.anna-activity-title').textContent).toBe('New chat message')
    expect(links[0].querySelector('.anna-activity-meta').textContent).toBe('Launch')
    expect(container.querySelector('.anna-messages').textContent.indexOf('Working here')).toBeLessThan(
        container.querySelector('.anna-messages').textContent.indexOf('created task')
    )
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    now.mockRestore()
})

it('uses the user date/time setting for messages and every notice, including changes while chat is open', () => {
    jest.useFakeTimers()
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
        act(() => jest.advanceTimersByTime(300))
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
        running: true,
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
        running: false,
        completedRequests: ['request'],
    })
})

it('keeps the current view as the last entry of the chat, after newer messages (AT-2914)', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    const entries = () =>
        [...container.querySelectorAll('.anna-context-notice, [data-anna-message-id]')].map(
            node => node.dataset.annaMessageId || node.querySelector('span').textContent
        )
    render({ pageContext: { surface: 'alldone', path: '/tasks', title: 'Tasks' } })
    mockMessages = [{ id: 'm1', creatorId: 'u1', created: 2000, commentText: 'Open a note' }]
    render({ pageContext: { surface: 'alldone', path: '/tasks', title: 'Tasks' } })
    expect(entries()).toEqual(['m1', 'Looking at: Tasks'])
    now.mockReturnValue(3000)
    render({ pageContext: { surface: 'alldone', path: '/notes', title: 'Notes' } })
    expect(entries()).toEqual(['m1', 'Looking at: Notes'])
})

it('records a project chosen in the switcher in the chat history of that project (AT-2914)', () => {
    jest.spyOn(Date, 'now').mockReturnValue(5000)
    const p1 = { projectId: 'p1', id: 'anna_u1', assistantId: 'a1' }
    const p2 = { projectId: 'p2', id: 'anna_p2', assistantId: 'a1' }
    const threads = [
        { projectId: 'p1', chatId: 'anna_u1', created: 1 },
        { projectId: 'p2', chatId: 'anna_p2', created: 2 },
    ]
    Object.assign(mockThreadMessages, {
        anna_u1: [{ id: 'm1', creatorId: 'u1', created: 1000, commentText: 'Hello' }],
        anna_p2: [{ id: 'm2', creatorId: 'u1', created: 3000, commentText: 'Earlier in Familie' }],
    })
    const pageContext = { surface: 'alldone', path: '/tasks', title: 'Alldone Product - Tasks' }
    const switchNotices = () =>
        [...container.querySelectorAll('[data-anna-project-switch]')].map(node => [
            node.dataset.annaProjectSwitch,
            node.closest('section').querySelector('[data-anna-message-id]')?.dataset.annaMessageId,
            node.querySelector('span').textContent,
        ])
    render({ conversation: p1, threads, pageContext })
    // While the chosen project's chat is still resolving nothing is recorded yet.
    const toFamilie = { id: 1, projectId: 'p2', name: 'Familie', created: 4000 }
    render({ conversation: p1, threads, pageContext, projectSwitch: toFamilie })
    expect(switchNotices()).toEqual([])
    render({ conversation: p2, threads, pageContext, projectSwitch: toFamilie })
    expect(switchNotices()).toEqual([['p2', 'm2', 'Switched to project: Familie']])
    // The current view moves with the conversation and exists only once.
    expect(container.querySelectorAll('.anna-view-notice')).toHaveLength(1)
    expect(
        container.querySelector('.anna-view-notice').closest('section').querySelector('[data-anna-message-id]').dataset
            .annaMessageId
    ).toBe('m2')
    // Re-rendering the same choice does not add a second entry; switching back adds one to that thread.
    render({ conversation: p2, threads, pageContext, projectSwitch: { ...toFamilie } })
    const back = { id: 2, projectId: 'p1', name: 'Alldone Product', created: 6000 }
    render({ conversation: p1, threads, pageContext, projectSwitch: back })
    expect(switchNotices()).toEqual([
        ['p2', 'm2', 'Switched to project: Familie'],
        ['p1', 'm1', 'Switched to project: Alldone Product'],
    ])
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('keeps context hints scoped to the account and daily conversation', () => {
    const pageContext = { surface: 'alldone', path: '/tasks', title: 'Tasks' }
    render({ pageContext })
    render({ pageContext: null })
    // No open view (chat-only mode) means no view indicator.
    expect(container.querySelectorAll('.anna-context-notice')).toHaveLength(0)
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
        { id: 'm1', created: expect.any(Number), requestsAssistantRun: true, threadGateCleared: true }
    )
    expect(mockContextUpdate.mock.invocationCallOrder[0]).toBeLessThan(createObjectMessage.mock.invocationCallOrder[0])
    expect(runHttpsCallableFunction).toHaveBeenCalledWith(
        'askToBotSecondGen',
        expect.objectContaining({ messageId: 'm1', assistantId: 'a1', isPublicFor: [0] }),
        { timeout: 3600000 }
    )
})

it('waits for displayed notices to reach shared storage before asking the assistant to read them', async () => {
    const write = deferred()
    mockContextSet.mockReturnValueOnce(write.promise)
    const published = publishAnnaActivityContext('u1', {
        id: 'chat/p1/topic/send-context',
        userId: 'u1',
        kind: 'chat',
        sourceProjectId: 'p1',
        projectId: 'p1',
        chatId: 'anna_u1',
        created: 1,
        content: { label: 'Agenda updated' },
    })
    render()
    type('What is this update about?')
    await submit()
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    await act(async () => {
        write.resolve()
        await published
    })
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    expect(mockContextSet.mock.calls[0][0].content.label).toBe('Agenda updated')
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
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({ call: { status: 'idle', startCall, endCall: jest.fn() } })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).toHaveBeenCalledWith({
        assistant: { displayName: 'Existing assistant' },
        resolveTarget: expect.any(Function),
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
        { id: 'm1', created: expect.any(Number), requestsAssistantRun: true, threadGateCleared: true }
    )
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(onResumeHandled).toHaveBeenCalledWith('resume1')
})

it('resolves the authoritative thread before starting voice and keeps the draft intact', async () => {
    let finish
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    const resolveConversation = jest.fn(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    render({ call: { status: 'idle', startCall, endCall: jest.fn() }, resolveConversation })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Cancel call"]')).not.toBeNull()
    await act(async () => finish({ projectId: 'p2', id: 'today', assistantId: 'a2' }))
    await expect(startCall.mock.results[0].value).resolves.toEqual({
        projectId: 'p2',
        chatId: 'today',
        assistant: { displayName: 'Existing assistant', uid: 'a2' },
    })
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('cancels voice while waiting for conversation validation without starting a late call', async () => {
    let finish
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({
        call: { status: 'idle', startCall, endCall: jest.fn() },
        resolveConversation: () =>
            new Promise(resolve => {
                finish = resolve
            }),
    })
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(container.querySelector('[data-testid="voice-call-connecting"]').textContent).toContain(
        'Connecting with Existing assistant…'
    )
    expect(container.querySelector('[data-testid="voice-call-connecting"]').getAttribute('role')).toBe('status')
    await click('Cancel call')
    expect(container.querySelector('[data-testid="voice-call-connecting"]')).toBeNull()
    await act(async () => finish({ projectId: 'p1', id: 'today', assistantId: 'a1' }))
    expect(startCall).toHaveBeenCalledTimes(1)
    await expect(startCall.mock.results[0].value).resolves.toBeNull()
    expect(container.querySelector('textarea').disabled).toBe(false)
})

it('keeps the draft and reports a failed voice target lookup', async () => {
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({
        call: { status: 'idle', startCall, endCall: jest.fn() },
        resolveConversation: async () => {
            throw new Error('Offline')
        },
    })
    await click('Find a note')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(container.querySelector('[role="alert"]').textContent).toBe('Offline')
    expect(container.querySelector('textarea').value).toBe('Find a note')
    expect(startCall).toHaveBeenCalledTimes(1)
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

it('queues a second message until the first assistant run has settled and keeps aggregate busy state (AT-2922)', async () => {
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
    // The second message waits, unsent, at the end of the conversation.
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].messageId)).toEqual(['first'])
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    const queued = container.querySelector('.anna-message-queued')
    expect(queued.textContent).toContain('Two')
    expect(queued.textContent).toContain('Queued. Sends when the current answer is finished.')
    expect([...container.querySelectorAll('.anna-message-user')].at(-1)).toBe(queued)
    expect(container.querySelector('textarea').disabled).toBe(false)
    expect(onSendingChange).toHaveBeenLastCalledWith(true)

    const firstCreated = createObjectMessage.mock.calls[0][11].created
    await act(async () => first.resolve({}))
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].messageId)).toEqual(['first', 'second'])
    expect(createObjectMessage).toHaveBeenCalledTimes(2)
    expect(createObjectMessage.mock.calls[1][11].created).toBeGreaterThanOrEqual(firstCreated)
    expect(container.querySelector('.anna-message-queued')).toBeNull()
    expect(onSendingChange).toHaveBeenLastCalledWith(true)
    await act(async () => second.resolve({}))
    expect(onSendingChange).toHaveBeenLastCalledWith(false)
    expect(container.querySelector('textarea').value).toBe('Still writing a third')
})

it('dispatches the next queued message after a failed run, and lets a queued message be sent now or removed (AT-2922)', async () => {
    const first = deferred()
    const third = deferred()
    createObjectMessage.mockImplementation((...args) => Promise.resolve(args[11].id))
    runHttpsCallableFunction.mockReturnValueOnce(first.promise).mockReturnValueOnce(third.promise)
    render()
    type('One')
    await submit()
    type('Two')
    await submit()
    type('Three')
    await submit()
    expect(container.querySelectorAll('.anna-message-queued')).toHaveLength(2)
    // Removing the second one withdraws it without ever writing it.
    const removeButton = [...container.querySelectorAll('.anna-message-queued')]
        .find(node => node.textContent.includes('Two'))
        .querySelector('[aria-label$="Remove queued message"]')
    await act(async () => removeButton.click())
    expect(container.textContent).not.toContain('Two')
    // A failed answer releases the queue as well.
    await act(async () => first.reject(new Error('Could not connect')))
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].messageId)).toEqual(['m1', 'm3'])
    expect(createObjectMessage.mock.calls.map(call => call[2])).toEqual(['One', 'Three'])
    await act(async () => third.resolve({}))

    // "Send now" skips the wait.
    const fourth = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(fourth.promise).mockReturnValueOnce(Promise.resolve({}))
    type('Four')
    await submit()
    type('Five')
    await submit()
    expect(container.querySelectorAll('.anna-message-queued')).toHaveLength(1)
    const sendNowButton = container.querySelector('.anna-message-queued [aria-label$="Send now"]')
    await act(async () => sendNowButton.click())
    expect(runHttpsCallableFunction.mock.calls.map(call => call[1].messageId)).toEqual(['m1', 'm3', 'm4', 'm5'])
    await act(async () => fourth.resolve({}))
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
    expect(createObjectMessage.mock.calls[0][11]).toMatchObject({
        id: 'm1',
        created: expect.any(Number),
        requestsAssistantRun: true,
    })
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
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({ onBeforeSend, call: { status: 'idle', startCall, endCall: jest.fn() } })
    type('Preserve my text draft')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(onBeforeSend).toHaveBeenCalledTimes(1)
    expect(startCall).toHaveBeenCalledTimes(1)
    await act(async () => handback.resolve())
    expect(startCall).toHaveBeenCalledTimes(1)
    expect(container.querySelector('textarea').value).toBe('Preserve my text draft')
    expect(createObjectMessage).not.toHaveBeenCalled()
})

it('keeps voice from starting if automatic handback fails or preparation is cancelled', async () => {
    const handback = deferred()
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    const onBeforeSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('Workspace unavailable'))
        .mockReturnValueOnce(handback.promise)
    render({ onBeforeSend, call: { status: 'idle', startCall, endCall: jest.fn() } })
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    expect(startCall).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]').textContent).toContain('Workspace unavailable')
    await act(async () => container.querySelector('[aria-label="Talk with Existing assistant"]').click())
    await act(async () => container.querySelector('[aria-label="Cancel call"]').click())
    await act(async () => handback.resolve())
    expect(startCall).toHaveBeenCalledTimes(2)
    await expect(startCall.mock.results[1].value).resolves.toBeNull()
})

it('keeps an offline draft across remounts and sends it only after reconnecting', async () => {
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({ offline: true, call: { status: 'idle', startCall, endCall: jest.fn() } })
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

it('shows the real activity card immediately through slow preparation, delivery, failure and retry', async () => {
    const resolution = deferred()
    const delivery = deferred()
    const response = deferred()
    commentOutbox.retry.mockReturnValueOnce(delivery.promise)
    runHttpsCallableFunction.mockReturnValueOnce(response.promise)
    render({ resolveConversation: () => resolution.promise })
    type('Create a task')
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(container.querySelector('.anna-pending-activity [data-testid="assistant-progress"]')).not.toBeNull()
    expect(container.textContent).toContain('assistant_progress_sending')
    expect(container.textContent).not.toContain('assistant_progress_thinking_1')
    type('Keep my next draft')
    await act(async () => resolution.resolve({ projectId: 'p1', id: 'anna_u1', assistantId: 'a1' }))
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    expect(container.textContent).toContain('assistant_progress_sending')
    await act(async () => delivery.resolve())
    expect(container.textContent).toContain('assistant_progress_waiting')
    expect(container.querySelectorAll('[data-testid="assistant-progress"]')).toHaveLength(1)
    await act(async () => response.reject(new Error('Could not connect')))
    expect(container.querySelector('.anna-pending-activity')).toBeNull()
    expect(container.querySelector('[role="alert"]').textContent).toContain('Could not connect')
    const retried = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(retried.promise)
    await click('Retry')
    expect(container.querySelector('.anna-pending-activity')).not.toBeNull()
    expect(container.querySelector('textarea').value).toBe('Keep my next draft')
    await act(async () => retried.resolve({}))
    expect(container.querySelector('.anna-pending-activity')).toBeNull()
})

it('keeps a follow-up startup card until that exact message has a backend response', async () => {
    const first = deferred(),
        second = deferred()
    createObjectMessage.mockImplementation((...args) => Promise.resolve(args[11].id))
    runHttpsCallableFunction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mockCreators.a1 = { displayName: 'Carl', isAssistant: true }
    render()
    type('First request')
    await submit()
    mockMessages = [
        {
            id: 'reply1',
            creatorId: 'a1',
            isLoading: true,
            lastChangeDate: Date.now(),
            assistantRun: { kind: 'chat', triggerMessageId: 'm1' },
        },
    ]
    render()
    expect(container.querySelector('.anna-pending-activity')).toBeNull()
    type('Follow up')
    await submit()
    // AT-2922: the follow-up waits for the first answer instead of starting a second run.
    expect(container.querySelector('.anna-message-queued')).not.toBeNull()
    expect(container.querySelector('.anna-pending-activity')).toBeNull()
    mockMessages[0] = {
        ...mockMessages[0],
        isLoading: false,
        assistantRun: { ...mockMessages[0].assistantRun, status: 'completed' },
    }
    await act(async () => first.resolve({}))
    expect(container.querySelector('.anna-message-queued')).toBeNull()
    expect(container.querySelector('.anna-pending-activity')).not.toBeNull()
    // A fast answer may arrive complete, without a loading snapshot ever reaching the browser.
    mockMessages.push({
        id: 'reply2',
        creatorId: 'a1',
        commentText: 'Done',
        isLoading: false,
        assistantRun: { kind: 'chat', triggerMessageId: 'm2', status: 'completed' },
    })
    render()
    expect(container.querySelector('.anna-pending-activity')).toBeNull()
    await act(async () => second.resolve({}))
})

it.each(['running', 'cancel_requested'])(
    'hands the early activity card over to its %s backend response',
    async status => {
        const pending = deferred()
        runHttpsCallableFunction.mockReturnValueOnce(pending.promise)
        mockCreators.a1 = { displayName: 'Carl', isAssistant: true, photoURL: 'carl.png' }
        render()
        type('Please help')
        await submit()
        expect(container.querySelector('.anna-pending-activity [data-testid="assistant-progress"]')).not.toBeNull()
        expect(container.textContent).toContain('assistant_progress_waiting')
        expect(container.textContent).not.toContain('is working…')
        mockMessages = [
            {
                id: 'response',
                creatorId: 'a1',
                fromAssistant: true,
                isLoading: true,
                lastChangeDate: Date.now(),
                commentText: 'Working',
                assistantRun: { kind: 'chat', status, runId: 'r1', triggerMessageId: 'm1' },
            },
        ]
        render()
        expect(container.querySelector('.anna-pending-activity')).toBeNull()
        const author = container.querySelector('[data-anna-message-id="response"] .anna-message-author')
        expect(author.firstElementChild.className).toBe('anna-message-avatar')
        expect(author.querySelector('.anna-message-author-name').textContent).toBe('Carl')
        expect(author.querySelector('.anna-message-avatar').innerHTML).toContain('carl.png')
        expect(container.querySelector('.anna-message-user .anna-message-avatar')).toBeNull()
        // Once the server owns this response, stale/completed cards must not bring back a startup card.
        mockMessages[0].lastChangeDate = Date.now() - 6 * 60 * 1000
        render()
        expect(container.querySelector('.anna-pending-activity')).toBeNull()
        mockMessages[0].isLoading = false
        mockMessages[0].commentText = 'Finished'
        render()
        expect(container.querySelector('.anna-pending-activity')).toBeNull()
        await act(async () => pending.resolve({}))
    }
)

it('does not let an earlier thread hide the startup card for a new request', async () => {
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
    expect(container.querySelector('.anna-pending-activity')).not.toBeNull()
    render({ threads: [threads[1]] })
    expect(container.querySelector('.anna-pending-activity')).not.toBeNull()
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
    expect(container.textContent).toContain('assistant_progress_waiting')
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

it('shows connecting feedback until ready and returns to the duration on success', () => {
    render({ call: { status: 'connecting' } })
    expect(container.querySelector('[data-testid="voice-call-connecting"]').textContent).toContain(
        'Connecting with Existing assistant…'
    )
    expect(container.querySelector('.anna-composer-footer').textContent).not.toContain('0:00')
    render({ call: { status: 'connected', voiceSeconds: 12 } })
    expect(container.querySelector('[data-testid="voice-call-connecting"]')).toBeNull()
    expect(container.querySelector('.anna-composer-footer').style.visibility).toBe('hidden')
    expect(container.querySelector('.anna-call-duration').textContent).toContain('0:12')
    render({ call: { status: 'idle', error: 'Could not start assistant call' } })
    expect(container.querySelector('[role="alert"]').textContent).toContain('Could not start assistant call')
    expect(container.querySelector('[aria-label="Talk with Existing assistant"]').disabled).toBe(false)
})

it('replaces the editor with audio controls during a call and restores the same draft afterward', async () => {
    render()
    type('Keep this exact draft')
    const editor = container.querySelector('textarea')
    const toggleMicrophoneMuted = jest.fn()
    render({ call: { status: 'connected', voiceSeconds: 65, toggleMicrophoneMuted } })
    expect(container.querySelector('textarea')).toBe(editor)
    expect(editor.closest('[inert][aria-hidden="true"]')).not.toBeNull()
    expect(editor.disabled).toBe(true)
    expect(container.querySelector('.anna-composer-field .anna-call-audio')).not.toBeNull()
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    expect(container.querySelector('.anna-call-duration').textContent).toContain('1:05')
    expect(container.querySelector('.anna-composer-footer').style.visibility).toBe('hidden')
    expect(container.querySelector('[aria-label="Select kind of file to add"]').closest('[inert]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Send message"]').closest('[inert]')).not.toBeNull()
    await act(async () => container.querySelector('[aria-label="Mute assistant call"]').click())
    expect(toggleMicrophoneMuted).toHaveBeenCalledTimes(1)
    await submit()
    expect(createObjectMessage).not.toHaveBeenCalled()
    render()
    expect(container.querySelector('textarea')).toBe(editor)
    expect(editor.closest('[inert]')).toBeNull()
    expect(editor.disabled).toBe(false)
    expect(editor.value).toBe('Keep this exact draft')
    expect(container.querySelector('.anna-call-audio')).toBeNull()
    expect(container.querySelector('[aria-label="Send message"]').disabled).toBe(false)
})

it('a rapid second phone click cancels preparation without starting duplicate calls', async () => {
    const pending = deferred()
    const resolveConversation = jest.fn(() => pending.promise)
    const startCall = jest.fn(async ({ resolveTarget }) => resolveTarget())
    render({ resolveConversation, call: { status: 'idle', startCall, endCall: jest.fn() } })
    const phone = container.querySelector('[aria-label="Talk with Existing assistant"]')
    act(() => {
        phone.click()
        phone.click()
    })
    await act(async () => pending.resolve({ id: 'today', projectId: 'p1', assistantId: 'a1' }))
    expect(resolveConversation).toHaveBeenCalledTimes(1)
    expect(startCall).toHaveBeenCalledTimes(1)
    await expect(startCall.mock.results[0].value).resolves.toBeNull()
    expect(container.querySelector('[data-testid="voice-call-connecting"]')).toBeNull()
})

it('exposes audio recovery outside the hidden composer while connecting', async () => {
    const playCallAudio = jest.fn()
    render({ call: { status: 'connecting', needsAudioPlayback: true, playCallAudio } })
    const enable = container.querySelector('[aria-label="Enable call audio"]')
    expect(container.querySelectorAll('[aria-label="Enable call audio"]')).toHaveLength(1)
    expect(enable.closest('.anna-composer-connecting')).not.toBeNull()
    expect(enable.closest('[aria-hidden="true"]')).toBeNull()
    await act(async () => enable.click())
    expect(playCallAudio).toHaveBeenCalledTimes(1)
})

describe('selected project (AT-2903)', () => {
    const threads = [
        { projectId: 'p1', chatId: 'AnnaChat20261029u1', dateKey: '20261029', assistantId: 'a1', created: 1 },
        { projectId: 'p2', chatId: 'AnnaChat20261029u1', dateKey: '20261029', assistantId: 'cto', created: 2 },
    ]
    const sections = () => [...container.querySelectorAll('.anna-date-divider')].map(divider => divider.textContent)
    beforeEach(() => {
        mockActivityState = {
            ...mockActivityState,
            loggedUserProjectsMap: { p1: { id: 'p1', name: 'Home' }, p2: { id: 'p2', name: 'Alldone Product' } },
            projectAssistants: { p2: [{ uid: 'cto', displayName: 'Alldone CTO' }] },
        }
    })

    it('labels each project section and keeps the composer’s chat last after switching back', () => {
        render({
            threads,
            conversation: { projectId: 'p1', id: 'AnnaChat20261029u1', assistantId: 'a1' },
            assistant: { uid: 'a1', displayName: 'Anna' },
            user: { uid: 'u1', gold: 100, defaultProjectId: 'p1' },
        })
        expect(sections()).toEqual(['2026-10-29 · Alldone Product · Alldone CTO', '2026-10-29 · Home · Anna'])
    })

    it('shows no project label while every section is in the default project', () => {
        render({
            threads: [threads[0]],
            conversation: { projectId: 'p1', id: 'AnnaChat20261029u1', assistantId: 'a1' },
            user: { uid: 'u1', gold: 100, defaultProjectId: 'p1' },
        })
        expect(sections()).toEqual(['2026-10-29'])
    })

    it('holds sending and calls until the selected project’s chat is ready, keeping the draft', async () => {
        const renderProjectSwitcher = jest.fn(() => <span data-testid="project-chip" />)
        render({ switching: true, renderProjectSwitcher })
        type('For the product project')
        expect(container.querySelector('.anna-send').disabled).toBe(true)
        expect(container.querySelector('[aria-label="Talk with Existing assistant"]').disabled).toBe(true)
        await submit()
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(container.querySelector('textarea').value).toBe('For the product project')
        expect(container.querySelector('.anna-composer-tools [data-testid="project-chip"]')).not.toBeNull()
        expect(renderProjectSwitcher).toHaveBeenLastCalledWith({ disabled: false })
        render({ switching: false, renderProjectSwitcher })
        expect(container.querySelector('.anna-send').disabled).toBe(false)
    })
})

describe('a request whose connection dropped while the app was in the background (AT-2921)', () => {
    // What the callable SDK throws for a failed fetch (status 0): the server never answered us.
    const connectionLost = () => Object.assign(new Error('internal'), { code: 'functions/internal' })
    const question = { id: 'm1', creatorId: 'u1', created: 1, commentText: 'Find a note' }
    const reply = (status, extra = {}) => ({
        id: 'reply1',
        creatorId: 'a1',
        fromAssistant: true,
        created: 2,
        isLoading: status === 'running',
        lastChangeDate: Date.now(),
        commentText: status === 'failed' ? 'Something went wrong.' : 'Here is your note.',
        assistantRun: { kind: 'chat', status, triggerMessageId: 'm1' },
        ...extra,
    })
    const alert = () => container.querySelector('.anna-message-user [role="alert"]')
    const retryButton = () => [...container.querySelectorAll('button')].find(node => node.textContent === 'Retry')
    let visibility
    let uninstallAppResume
    beforeEach(() => {
        visibility = 'visible'
        jest.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
        mockCreators.a1 = { displayName: 'Carl', isAssistant: true }
        // The real lifecycle owner, as AppNavigator installs it, with its network side effects stubbed.
        uninstallAppResume = installAppResumeListener({
            evaluateConnection: () => {},
            runIntegrityCheck: () => {},
            updateServiceWorker: () => {},
        })
    })
    afterEach(() => uninstallAppResume())
    const setVisibility = value =>
        act(() => {
            visibility = value
            document.dispatchEvent(new Event('visibilitychange'))
        })

    it('shows no error or Retry when the answer is already in the chat on return (the reported case)', async () => {
        const request = deferred()
        runHttpsCallableFunction.mockReturnValueOnce(request.promise)
        render()
        await click('Find a note')
        await submit()
        setVisibility('hidden')
        // The server finished while the app was in the background...
        mockMessages = [question, reply('completed')]
        render()
        // ...and the OS-dropped connection only rejects afterwards.
        await act(async () => request.reject(connectionLost()))
        setVisibility('visible')
        expect(alert()).toBeNull()
        expect(retryButton()).toBeUndefined()
        expect(container.textContent).not.toContain('internal')
        expect(container.querySelector('.anna-pending-activity')).toBeNull()
        expect(container.textContent).toContain('Here is your note.')
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
    })

    it('waits instead of failing when the connection drops before the reply has arrived', async () => {
        jest.useFakeTimers()
        runHttpsCallableFunction.mockRejectedValueOnce(connectionLost())
        render()
        await click('Find a note')
        await submit()
        // No error, no Retry: the message may well be in progress on the server.
        expect(alert()).toBeNull()
        expect(retryButton()).toBeUndefined()
        expect(container.querySelector('.anna-pending-activity')).not.toBeNull()
        expect(container.querySelector('textarea').disabled).toBe(false)
        await act(async () => jest.advanceTimersByTime(30000))
        mockMessages = [question, reply('running')]
        render()
        expect(container.querySelector('.anna-pending-activity')).toBeNull()
        mockMessages = [question, reply('completed')]
        render()
        // Past the deadline the settled message must never come back as a failure.
        await act(async () => jest.advanceTimersByTime(10 * 60 * 1000))
        expect(alert()).toBeNull()
        expect(retryButton()).toBeUndefined()
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    })

    it('settles on a reply even when its own message has not reached the snapshot yet', async () => {
        jest.useFakeTimers()
        runHttpsCallableFunction.mockRejectedValueOnce(connectionLost())
        render()
        await click('Find a note')
        await submit()
        mockMessages = [reply('completed')]
        render()
        await act(async () => jest.advanceTimersByTime(10 * 60 * 1000))
        expect(alert()).toBeNull()
        expect(container.querySelector('.anna-message-user').textContent).toContain('Find a note')
    })

    it('reports a readable failure, not "internal", once no reply arrives while the page is visible', async () => {
        jest.useFakeTimers()
        runHttpsCallableFunction.mockRejectedValueOnce(connectionLost())
        render()
        await click('Find a note')
        await submit()
        setVisibility('hidden')
        // Nothing can be confirmed while hidden, however long that lasts.
        await act(async () => jest.advanceTimersByTime(60 * 60 * 1000))
        expect(alert()).toBeNull()
        setVisibility('visible')
        await act(async () => jest.advanceTimersByTime(14000))
        expect(alert()).toBeNull()
        await act(async () => jest.advanceTimersByTime(2000))
        expect(alert().textContent).toContain('The connection was interrupted. Please try again.')
        expect(alert().textContent).not.toContain('internal')
        await click('Retry')
        expect(createObjectMessage).toHaveBeenCalledTimes(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
        expect(runHttpsCallableFunction.mock.calls[1][1].messageId).toBe('m1')
        expect(alert()).toBeNull()
    })

    it('hides a timed-out failure as soon as a late reply (e.g. the server catch-up) arrives', async () => {
        jest.useFakeTimers()
        runHttpsCallableFunction.mockRejectedValueOnce(connectionLost())
        render()
        await click('Find a note')
        await submit()
        await act(async () => jest.advanceTimersByTime(3 * 60 * 1000))
        expect(alert()).not.toBeNull()
        mockMessages = [question, reply('running')]
        render()
        expect(alert()).toBeNull()
        expect(retryButton()).toBeUndefined()
    })

    it('still offers Retry when the run itself failed on the server', async () => {
        jest.useFakeTimers()
        runHttpsCallableFunction.mockRejectedValueOnce(connectionLost())
        render()
        await click('Find a note')
        await submit()
        mockMessages = [question, reply('failed')]
        render()
        expect(alert().textContent).toContain('The assistant could not answer this message. Please try again.')
        await click('Retry')
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
        expect(runHttpsCallableFunction.mock.calls[1][1].messageId).toBe('m1')
    })

    it('still reports an error the server actually returned, immediately', async () => {
        runHttpsCallableFunction.mockRejectedValueOnce(
            Object.assign(new Error('Not enough Gold'), { code: 'functions/resource-exhausted' })
        )
        render()
        await click('Find a note')
        await submit()
        expect(alert().textContent).toContain('Not enough Gold')
        expect(retryButton()).not.toBeUndefined()
    })

    it('does not treat a failure before the request was sent as a lost connection', async () => {
        commentOutbox.read.mockReturnValue({ status: 'pending' })
        render()
        await click('Find a note')
        await submit()
        expect(alert().textContent).toContain('Your message could not be sent. Please try again.')
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })
})
