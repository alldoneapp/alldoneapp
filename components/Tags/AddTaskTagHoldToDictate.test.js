/**
 * @jest-environment jsdom
 *
 * Holding the task board's floating "+" enters the same mode as holding the mic inside the open
 * add-task popup (AT-2823). Real DOM events, the REAL AddTaskTag gesture wiring and the REAL
 * RambleButton (gesture handoff, hold overlay, push-to-talk decision). Only the recorder, the
 * popover shell and the popup body are doubles: the popup double renders the real mic with the
 * handoff it receives, which is exactly what CustomTextInput3 does for the title input.
 */
import React from 'react'
import { act } from 'react-test-renderer'
import { createRoot } from 'react-dom/client'

import {
    PUSH_TO_TALK_CANCEL_RADIUS,
    PUSH_TO_TALK_HOLD_MS,
    PUSH_TO_TALK_MIN_RECORDING_MS,
} from '../UIControls/pushToTalk'

let mockRecording
const mockStart = jest.fn(() => {
    mockRecording = true
})
const mockStop = jest.fn(() => true)
const mockCancel = jest.fn()
let mockDictationSupported = true
let mockPopupMounts = 0

jest.mock('../../hooks/useRambleRecorder', () => ({
    __esModule: true,
    isDictationSupported: () => mockDictationSupported,
    default: jest.fn(() => ({
        isRecording: mockRecording,
        elapsedSeconds: 0,
        start: mockStart,
        stop: mockStop,
        cancel: mockCancel,
        getInputLevel: () => 0.2,
    })),
}))
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ isQuillTagEditorOpen: false, openModals: {}, smallScreenNavigation: false }),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())
jest.mock('../../hooks/useModalSizing', () => () => ({
    maxHeight: 600,
    isSheet: false,
    windowHeight: 800,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
}))
jest.mock('../../hooks/useLiftAboveKeyboard', () => () => 0)
jest.mock('../../hooks/useFloatPopupLock', () => () => ({ acquire: jest.fn(), release: jest.fn() }))
jest.mock('../../hooks/useTaskEditorLock', () => () => ({ acquire: jest.fn(), release: jest.fn() }))
jest.mock('../Icon', () => () => null)
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../utils/backends/Rambler/ramblerBackend', () => ({ processRamble: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: {} }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))
jest.mock('../styles/global', () => {
    const actual = jest.requireActual('../styles/global')
    return { __esModule: true, ...actual, windowTagStyle: () => ({}) }
})
jest.mock('../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention-modal' }))
jest.mock('../UIComponents/HOC/withSafePopover', () => Component => props => {
    const React = require('react')
    const [isOpen, setIsOpen] = React.useState(false)
    return (
        <Component
            openPopover={() => setIsOpen(true)}
            closePopover={() => setIsOpen(false)}
            isOpen={isOpen}
            {...props}
        />
    )
})
jest.mock('../UIComponents/ModalShell/AppPopover', () => props => {
    const React = require('react')
    return React.createElement(React.Fragment, null, props.children, props.isOpen ? props.content : null)
})
jest.mock('../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal', () => props => {
    const React = require('react')
    const RambleButton = require('../UIControls/RambleButton').default
    React.useEffect(() => {
        mockPopupMounts += 1
    }, [])
    return React.createElement(
        'div',
        { 'data-testid': 'create-task-popup' },
        React.createElement(RambleButton, {
            projectId: 'p1',
            onTextReady: jest.fn(),
            onSubmit: jest.fn(),
            pushToTalkHandoff: props.pushToTalkHandoff,
        })
    )
})

const AddTaskTag = require('./AddTaskTag').default

const PRESS = { clientX: 900, clientY: 700 }
let container
let root
let windowClick

const dispatch = (target, type, init = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, init)
    act(() => {
        target.dispatchEvent(event)
    })
    return event
}
const advance = ms =>
    act(() => {
        jest.advanceTimersByTime(ms)
    })

const plus = () => container.querySelector('[aria-label="Add task"]')
const popup = () => container.querySelector('[data-testid="create-task-popup"]')
const overlay = () => document.body.querySelector('[data-testid="ramble-hold-overlay"]')
// Once the popup is open the floating "+" no longer takes pointer events (FloatingAddTaskButton
// hides it while a task editor is open), so the trailing click of a mouse press lands on an
// ancestor rather than on the button — i.e. it reaches the popover's outside-click listener.
const trailingClick = (target = document.body) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
        target.dispatchEvent(event)
    })
}

const render = props =>
    act(() => {
        root.render(<AddTaskTag projectId="p1" floating {...props} />)
    })

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    global.IS_REACT_ACT_ENVIRONMENT = true
    mockRecording = false
    mockDictationSupported = true
    mockPopupMounts = 0
    windowClick = jest.fn()
    window.addEventListener('click', windowClick)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.removeEventListener('click', windowClick)
    advance(1000)
    jest.useRealTimers()
})

describe('holding the floating "+" (AT-2823)', () => {
    test('a short tap opens the popup as before and never touches the microphone', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(120)
        dispatch(window, 'mouseup', PRESS)
        trailingClick()

        expect(popup()).toBeTruthy()
        expect(mockPopupMounts).toBe(1)
        expect(mockStart).not.toHaveBeenCalled()
        // The trailing click is neither a second open nor an outside click for the popover.
        expect(windowClick).not.toHaveBeenCalled()
    })

    test('a touch tap opens the popup too (touch produces no click to rely on)', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'touchstart', { changedTouches: [{ identifier: 1, ...PRESS }] })
        advance(100)
        dispatch(window, 'touchend', { changedTouches: [{ identifier: 1, ...PRESS }] })

        expect(popup()).toBeTruthy()
        expect(mockStart).not.toHaveBeenCalled()
    })

    test('a stray click right after the gesture cannot reopen (remount) the popup', () => {
        render({ holdToDictate: true })

        // A touch press is not click-guarded (it normally produces no click), so a browser that
        // still emits one must be filtered by the onPress suppression instead.
        dispatch(plus(), 'touchstart', { changedTouches: [{ identifier: 1, ...PRESS }] })
        advance(100)
        dispatch(window, 'touchend', { changedTouches: [{ identifier: 1, ...PRESS }] })
        trailingClick(plus())

        expect(mockPopupMounts).toBe(1)
    })

    test('nothing opens and nothing records before the hold threshold', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS - 50)

        expect(popup()).toBeFalsy()
        expect(mockStart).not.toHaveBeenCalled()
    })

    test('hold → the popup opens straight into the mic hold; release submits the take', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS)

        expect(popup()).toBeTruthy()
        expect(mockStart).toHaveBeenCalledTimes(1)
        // Same ring as a hold on the mic, centred where the finger is — no extra delay.
        expect(overlay()).toBeTruthy()
        const ring = document.body.querySelector('[data-testid="ramble-hold-ring-safe"]')
        expect(ring.style.left).toBe(`${PRESS.clientX - PUSH_TO_TALK_CANCEL_RADIUS}px`)

        advance(1500)
        dispatch(window, 'mouseup', PRESS)
        trailingClick()

        // The push-to-talk SUBMIT path: transcribe, insert and create the task.
        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })
        expect(mockCancel).not.toHaveBeenCalled()
        expect(overlay()).toBeFalsy()
        // The click after a long mouse hold must not dismiss the popup mid-transcription.
        expect(windowClick).not.toHaveBeenCalled()
        expect(popup()).toBeTruthy()
        expect(mockPopupMounts).toBe(1)
    })

    test('sliding out of the ring before letting go discards the take', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS)
        advance(1000)
        dispatch(window, 'mousemove', {
            clientX: PRESS.clientX,
            clientY: PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 10,
        })
        dispatch(window, 'mouseup', {
            clientX: PRESS.clientX,
            clientY: PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 10,
        })

        expect(mockCancel).toHaveBeenCalledTimes(1)
        expect(mockStop).not.toHaveBeenCalled()
    })

    test('a touch hold behaves the same way', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'touchstart', { changedTouches: [{ identifier: 1, ...PRESS }] })
        advance(PUSH_TO_TALK_HOLD_MS + 1500)
        expect(mockStart).toHaveBeenCalledTimes(1)
        dispatch(window, 'touchend', { changedTouches: [{ identifier: 1, ...PRESS }] })

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })
    })

    test('the browser taking the gesture away mid-hold discards the take', () => {
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS + 800)
        dispatch(window, 'blur')

        expect(mockCancel).toHaveBeenCalledTimes(1)
        expect(mockStop).not.toHaveBeenCalled()
    })

    test('without dictation support a hold is just a press', () => {
        mockDictationSupported = false
        render({ holdToDictate: true })

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS + 500)

        expect(popup()).toBeFalsy()
        expect(mockStart).not.toHaveBeenCalled()
    })

    test('buttons that do not opt in keep their plain press behaviour', () => {
        render({})

        dispatch(plus(), 'mousedown', { button: 0, ...PRESS })
        advance(PUSH_TO_TALK_HOLD_MS + 500)

        expect(popup()).toBeFalsy()
        expect(mockStart).not.toHaveBeenCalled()
    })
})
