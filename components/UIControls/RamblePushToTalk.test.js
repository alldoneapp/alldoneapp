/**
 * @jest-environment jsdom
 *
 * Push-to-talk end to end at the controller level (AT-2405): press-down starts a take, and what
 * the RELEASE looked like decides whether that take is submitted, merely stopped, or thrown away.
 *
 * The two properties worth protecting here are the ones a user would notice immediately if they
 * broke: a quick tap must still behave exactly as it did before this feature existed (start
 * recording, wait for the second tap, insert the text, submit NOTHING), and a take must never be
 * auto-submitted unless the user actually held the button for it — an unwanted message posted into
 * a chat cannot be taken back.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useRambleController } from './RambleButton'
import { PUSH_TO_TALK_HOLD_MS, PUSH_TO_TALK_MIN_RECORDING_MS } from './pushToTalk'

let mockRecorderOptions
let mockRecording
let mockStopResult
const mockStart = jest.fn(() => {
    mockRecording = true
})
const mockStop = jest.fn(() => mockStopResult)
const mockCancel = jest.fn()

jest.mock('../../hooks/useRambleRecorder', () => ({
    __esModule: true,
    default: jest.fn(options => {
        mockRecorderOptions = options
        return {
            isRecording: mockRecording,
            elapsedSeconds: 0,
            start: mockStart,
            stop: mockStop,
            cancel: mockCancel,
        }
    }),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../../utils/backends/Rambler/ramblerBackend', () => ({ processRamble: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: {} }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))

const { processRamble } = require('../../utils/backends/Rambler/ramblerBackend')

let controller
let onTextReady
let onSubmit
let tree

const Harness = () => {
    controller = useRambleController({
        projectId: 'p1',
        onTextReady,
        onSubmit,
        getCurrentText: () => '',
    })
    return null
}

const render = () => {
    act(() => {
        tree = renderer.create(<Harness />)
    })
}

// The controller reads `isRecording` through a ref refreshed on every render, so a change to the
// mocked recorder state only reaches it once React re-renders — exactly as in the real app.
const rerender = () =>
    act(() => {
        tree.update(<Harness />)
    })

const pressDown = () =>
    act(() => {
        controller.handlePressStart()
    })

const release = (overrides = {}) =>
    act(() => {
        controller.handlePressEnd({ heldMs: 1500, releasedInside: true, cancelled: false, ...overrides })
    })

const completeTranscription = async (text = 'hello from the microphone') => {
    processRamble.mockResolvedValueOnce({ text })
    await act(async () => {
        await mockRecorderOptions.onComplete({
            audioBase64: 'data:audio/webm;base64,AA',
            mimeType: 'audio/webm',
            durationSeconds: 4,
        })
    })
}

beforeEach(() => {
    jest.clearAllMocks()
    mockRecording = false
    mockStopResult = true
    onTextReady = jest.fn()
    onSubmit = jest.fn()
    render()
})

describe('push-to-talk (AT-2405)', () => {
    test('press-down starts recording immediately, before it is known to be a hold', () => {
        pressDown()

        // Waiting for the hold threshold would swallow the first ~400ms of speech, which in
        // practice is the first word.
        expect(mockStart).toHaveBeenCalledTimes(1)
    })

    test('hold, speak, release: the transcript is inserted AND submitted', async () => {
        pressDown()
        rerender()
        release({ heldMs: PUSH_TO_TALK_HOLD_MS + 100 })

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })
        expect(mockCancel).not.toHaveBeenCalled()

        await completeTranscription('send this please')

        expect(onTextReady).toHaveBeenCalledWith('send this please')
        expect(onSubmit).toHaveBeenCalledWith('send this please')
    })

    test('a quick tap keeps recording and never submits — the legacy toggle, unchanged', async () => {
        pressDown()
        rerender()
        release({ heldMs: PUSH_TO_TALK_HOLD_MS - 50 })

        // Nothing stopped: the recording runs on until the user taps again.
        expect(mockStop).not.toHaveBeenCalled()
        expect(mockCancel).not.toHaveBeenCalled()

        // Second tap of the toggle: a press that lands on an already-running recording.
        pressDown()
        expect(mockStart).toHaveBeenCalledTimes(1)
        release({ heldMs: 80 })
        expect(mockStop).toHaveBeenCalledWith()

        await completeTranscription('typed by voice, sent by hand')

        expect(onTextReady).toHaveBeenCalledWith('typed by voice, sent by hand')
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('holding the button on a tap-started recording still does not submit it', async () => {
        pressDown()
        rerender()
        release({ heldMs: 100 })

        pressDown()
        release({ heldMs: 5000 })

        expect(mockStop).toHaveBeenCalledWith()
        await completeTranscription()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('sliding off the button before letting go throws the take away', async () => {
        pressDown()
        rerender()
        release({ heldMs: 2000, releasedInside: false })

        expect(mockCancel).toHaveBeenCalled()
        expect(mockStop).not.toHaveBeenCalled()

        // Nothing was uploaded, so no Gold was spent and nothing can arrive later to be submitted.
        await completeTranscription()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('a gesture the browser cancels ends the take without submitting', () => {
        pressDown()
        rerender()
        release({ cancelled: true })

        expect(mockCancel).toHaveBeenCalled()
        expect(mockStop).not.toHaveBeenCalled()
    })

    test('a hold too short to contain audio is discarded, not sent', async () => {
        // The recorder vetoes the take (released before the microphone opened, or under the
        // minimum) by returning false.
        mockStopResult = false
        pressDown()
        rerender()
        release({ heldMs: 600 })

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })

        // If a completion somehow still arrived, it must not be submitted.
        await completeTranscription()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('a failed take never submits, and cannot arm the next one', async () => {
        pressDown()
        rerender()
        release({ heldMs: 2000 })

        act(() => {
            mockRecorderOptions.onError('recorder-error')
        })
        await completeTranscription()

        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('an empty transcript inserts nothing and submits nothing', async () => {
        pressDown()
        rerender()
        release({ heldMs: 2000 })

        processRamble.mockResolvedValueOnce({ text: '' })
        await act(async () => {
            await mockRecorderOptions.onComplete({ audioBase64: 'data:x', mimeType: 'audio/webm', durationSeconds: 3 })
        })

        expect(onTextReady).not.toHaveBeenCalled()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('the arming is consumed, so a later tap-started take is not sent too', async () => {
        pressDown()
        rerender()
        release({ heldMs: 2000 })
        await completeTranscription('first, held')
        expect(onSubmit).toHaveBeenCalledTimes(1)

        mockRecording = false
        rerender()
        pressDown()
        rerender()
        release({ heldMs: 100 })
        pressDown()
        release({ heldMs: 100 })
        await completeTranscription('second, tapped')

        expect(onSubmit).toHaveBeenCalledTimes(1)
        expect(onTextReady).toHaveBeenLastCalledWith('second, tapped')
    })

    test('press-down is ignored while a previous take is still transcribing', async () => {
        pressDown()
        rerender()
        release({ heldMs: 2000 })

        processRamble.mockReturnValueOnce(new Promise(() => {}))
        act(() => {
            mockRecorderOptions.onComplete({ audioBase64: 'data:x', mimeType: 'audio/webm', durationSeconds: 3 })
        })

        mockStart.mockClear()
        pressDown()

        // Starting a second recording while the first is still being transcribed would race two
        // insertions into the same input.
        expect(mockStart).not.toHaveBeenCalled()
    })
})

/**
 * The wiring, driven through the REAL rendered button with REAL DOM events.
 *
 * The tests above exercise the state machine through the controller's own handlers, which proves
 * the decisions but not that anything is connected to them. This closes that gap: the ref reaches
 * the host node, the listeners land on it, and a press on the actual mic starts a recording. It is
 * the piece most likely to be silently broken by a refactor — a `TouchableOpacity` that stops
 * forwarding its ref, or a `visible` change that remounts the node — and none of it shows up as a
 * failure anywhere else.
 */
describe('the mic button is actually wired to the gesture', () => {
    const { createRoot } = require('react-dom/client')
    const RambleButton = require('./RambleButton').default

    let container
    let root

    const dispatch = (target, type, init = {}) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.assign(event, init)
        act(() => {
            target.dispatchEvent(event)
        })
    }

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            root.render(<RambleButton projectId="p1" onTextReady={onTextReady} onSubmit={onSubmit} />)
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const mic = () => container.querySelector('[aria-label="Dictate"]') || container.firstElementChild

    test('pressing the rendered mic starts a recording', () => {
        dispatch(mic(), 'mousedown', { button: 0, clientX: 5, clientY: 5 })

        expect(mockStart).toHaveBeenCalledTimes(1)
    })

    test('a held press on the rendered mic submits the transcript', async () => {
        const node = mic()
        dispatch(node, 'mousedown', { button: 0, clientX: 5, clientY: 5 })
        mockRecording = true
        // Real wall-clock: the gesture measures the hold with performance.now(), so the press has
        // to actually last longer than the threshold to count as one.
        await new Promise(resolve => setTimeout(resolve, PUSH_TO_TALK_HOLD_MS + 80))
        dispatch(window, 'mouseup', { clientX: 5, clientY: 5 })

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })

        processRamble.mockResolvedValueOnce({ text: 'held and sent' })
        await act(async () => {
            await mockRecorderOptions.onComplete({ audioBase64: 'data:x', mimeType: 'audio/webm', durationSeconds: 4 })
        })
        expect(onSubmit).toHaveBeenCalledWith('held and sent')
    })

    test('the press keeps the editor focused by preventing default', () => {
        const node = mic()
        const event = new Event('mousedown', { bubbles: true, cancelable: true })
        Object.assign(event, { button: 0, clientX: 5, clientY: 5 })
        act(() => {
            node.dispatchEvent(event)
        })

        // The old implementation did this with `onMouseDown` on the TouchableOpacity; losing it
        // would move the caret and the transcript would land in the wrong place.
        expect(event.defaultPrevented).toBe(true)
    })
})
