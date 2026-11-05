/**
 * @jest-environment jsdom
 *
 * PT-5425: a host that passes `claimBackgroundSubmit` (the add-task popup) may take over a
 * submitting push-to-talk release ON THE MIC ITSELF: the take is stopped detached, the host is
 * dismissed at once, and the transcript reaches the host's `submit` after the input is gone. It must
 * never also run the interactive insert+submit (that would create the task twice), every failure
 * must reach `onFailed` so the draft can be restored, and a host that declines must get exactly the
 * old behaviour. The hold handed over from the floating "+" (PT-5424) keeps its own path.
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
jest.mock('../../utils/redux/loadingOperation', () => ({ runWithLoading: jest.fn((key, run) => run()) }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: { language: 'de' } }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))
jest.mock('../../utils/swallowNextClick', () => ({ swallowNextClick: jest.fn() }))

const { processRamble } = require('../../utils/backends/Rambler/ramblerBackend')
const { runWithLoading } = require('../../utils/redux/loadingOperation')
const { swallowNextClick } = require('../../utils/swallowNextClick')

const RECORDING = { audioBase64: 'data:audio/webm;base64,AA', mimeType: 'audio/webm', durationSeconds: 4 }

let controller
let onTextReady
let onSubmit
let claimed
let claimBackgroundSubmit
let currentText
let tree

const Harness = () => {
    controller = useRambleController({
        projectId: 'p1',
        targetKind: 'title',
        onTextReady,
        onSubmit,
        claimBackgroundSubmit,
        getCurrentText: () => currentText,
    })
    return null
}

const holdAndRelease = (overrides = {}) => {
    act(() => {
        controller.handlePressStart()
    })
    act(() => {
        tree.update(<Harness />)
    })
    act(() => {
        controller.handlePressEnd({
            heldMs: PUSH_TO_TALK_HOLD_MS + 500,
            releasedInside: true,
            cancelled: false,
            kind: 'pointer',
            ...overrides,
        })
    })
}

const deliverRecording = async () => {
    await act(async () => {
        await mockRecorderOptions.onComplete(RECORDING)
    })
}

let alertSpy

beforeEach(() => {
    jest.clearAllMocks()
    mockRecording = false
    mockStopResult = true
    currentText = 'typed draft'
    onTextReady = jest.fn()
    onSubmit = jest.fn()
    claimed = { dismiss: jest.fn(), submit: jest.fn(() => Promise.resolve({ id: 't1' })), onFailed: jest.fn() }
    claimBackgroundSubmit = jest.fn(() => claimed)
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    act(() => {
        tree = renderer.create(<Harness />)
    })
})

afterEach(() => {
    jest.restoreAllMocks()
})

describe('a hold on the mic itself, finished in the background (PT-5425)', () => {
    test('release stops the take detached and dismisses the host before anything is transcribed', () => {
        holdAndRelease()

        expect(claimBackgroundSubmit).toHaveBeenCalledTimes(1)
        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS, detach: true })
        expect(claimed.dismiss).toHaveBeenCalledTimes(1)
        // Dismissed only AFTER the take was stopped and promised.
        expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(claimed.dismiss.mock.invocationCallOrder[0])
        expect(processRamble).not.toHaveBeenCalled()
        // A mouse press's trailing click must not land on what was under the closed popup.
        expect(swallowNextClick).toHaveBeenCalledTimes(1)
    })

    test('a touch release installs no click guard (touch leaves no click to swallow)', () => {
        holdAndRelease({ kind: 'touch' })
        expect(claimed.dismiss).toHaveBeenCalledTimes(1)
        expect(swallowNextClick).not.toHaveBeenCalled()
    })

    test('transcribes after the input unmounted, hands the text to the host, never inserts or submits itself', async () => {
        holdAndRelease()
        // The draft is read at release; later edits of an input that is already gone do not count.
        currentText = 'changed later'
        act(() => tree.unmount())

        processRamble.mockResolvedValueOnce({ text: 'call the dentist tomorrow' })
        await deliverRecording()

        expect(runWithLoading).toHaveBeenCalledTimes(1)
        expect(processRamble).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'p1',
                targetKind: 'title',
                currentText: 'typed draft',
                language: 'de',
            })
        )
        expect(claimed.submit).toHaveBeenCalledTimes(1)
        expect(claimed.submit).toHaveBeenCalledWith('call the dentist tomorrow')
        expect(claimed.onFailed).not.toHaveBeenCalled()
        expect(onTextReady).not.toHaveBeenCalled()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    test('a failed transcription is reported AND the host restores its draft', async () => {
        holdAndRelease()
        processRamble.mockRejectedValueOnce(new Error('EMPTY_TRANSCRIPT'))
        await deliverRecording()

        expect(alertSpy).toHaveBeenCalledWith('No speech detected')
        expect(claimed.submit).not.toHaveBeenCalled()
        expect(claimed.onFailed).toHaveBeenCalledTimes(1)
    })

    test('an empty transcript restores the draft instead of creating nothing silently', async () => {
        holdAndRelease()
        processRamble.mockResolvedValueOnce({ text: '' })
        await deliverRecording()

        expect(claimed.submit).not.toHaveBeenCalled()
        expect(claimed.onFailed).toHaveBeenCalledTimes(1)
    })

    test('a recorder error after release (e.g. a silent microphone) is reported and restores the draft', () => {
        holdAndRelease()
        act(() => {
            mockRecorderOptions.onError('silent-input', {})
        })

        expect(alertSpy).toHaveBeenCalledTimes(1)
        expect(claimed.onFailed).toHaveBeenCalledTimes(1)
        expect(processRamble).not.toHaveBeenCalled()
    })

    test('a take too short to keep never dismisses the host', () => {
        mockStopResult = false
        holdAndRelease()

        expect(claimed.dismiss).not.toHaveBeenCalled()
        expect(claimed.onFailed).not.toHaveBeenCalled()
        expect(swallowNextClick).not.toHaveBeenCalled()
    })

    test('a host that declines keeps the interactive insert-then-submit path', async () => {
        claimBackgroundSubmit = jest.fn(() => null)
        act(() => tree.update(<Harness />))
        holdAndRelease()

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })
        processRamble.mockResolvedValueOnce({ text: 'buy milk' })
        await deliverRecording()

        expect(onTextReady).toHaveBeenCalledWith('buy milk')
        expect(onSubmit).toHaveBeenCalledWith('buy milk')
    })

    test('a tap or a slide-to-cancel never asks the host', () => {
        holdAndRelease({ heldMs: 100 })
        holdAndRelease({ cancelled: true })
        expect(claimBackgroundSubmit).not.toHaveBeenCalled()
        expect(claimed.dismiss).not.toHaveBeenCalled()
    })

    test('a hold handed over from the floating "+" uses its own background submit, not the claim', async () => {
        const handoffSubmit = jest.fn(() => Promise.resolve(null))
        holdAndRelease({ handedOver: true, backgroundSubmitOnRelease: handoffSubmit })

        expect(claimBackgroundSubmit).not.toHaveBeenCalled()
        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS, detach: true })
        // The "+" opener installs its own click guard (AT-2823).
        expect(swallowNextClick).not.toHaveBeenCalled()

        processRamble.mockResolvedValueOnce({ text: 'water the plants' })
        await deliverRecording()
        expect(handoffSubmit).toHaveBeenCalledWith('water the plants')
        expect(onSubmit).not.toHaveBeenCalled()
    })
})
