/**
 * @jest-environment jsdom
 *
 * Recorder state machine for rambler dictation: mime probing (webm → mp4, never hardcoded),
 * one-shot record/stop/cancel, the max-duration auto-stop, the size guard, and permission errors.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useRambleRecorder, {
    pickSupportedMimeType,
    isDictationSupported,
    RAMBLE_MAX_DURATION_SECONDS,
    RAMBLE_MAX_AUDIO_BYTES,
} from './useRambleRecorder'

let recorderInstances
let supportedTypes

class MockMediaRecorder {
    static isTypeSupported(type) {
        return supportedTypes.includes(type)
    }
    constructor(stream, options = {}) {
        this.stream = stream
        this.mimeType = options.mimeType || 'audio/default'
        this.state = 'recording'
        recorderInstances.push(this)
    }
    start() {}
    stop() {
        this.state = 'inactive'
        this.onstop?.()
    }
}

const mockTrack = () => ({ stop: jest.fn() })

const buildStream = () => {
    const tracks = [mockTrack()]
    return { getTracks: () => tracks, tracks }
}

let hookValue
const Harness = ({ options }) => {
    hookValue = useRambleRecorder(options)
    return null
}

const renderHook = options => {
    let root
    act(() => {
        root = renderer.create(<Harness options={options} />)
    })
    return root
}

const originalMediaDevices = navigator.mediaDevices

beforeEach(() => {
    jest.useFakeTimers()
    recorderInstances = []
    supportedTypes = ['audio/webm;codecs=opus', 'audio/webm']
    global.MediaRecorder = MockMediaRecorder
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: jest.fn(async () => buildStream()) },
    })
})

afterEach(() => {
    jest.useRealTimers()
    delete global.MediaRecorder
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices })
})

describe('pickSupportedMimeType', () => {
    test('prefers opus webm, falls back to mp4 on Safari-like support', () => {
        expect(pickSupportedMimeType()).toBe('audio/webm;codecs=opus')
        supportedTypes = ['audio/mp4']
        expect(pickSupportedMimeType()).toBe('audio/mp4')
        supportedTypes = []
        expect(pickSupportedMimeType()).toBeUndefined()
    })
})

describe('isDictationSupported', () => {
    test('true with MediaRecorder + getUserMedia, false without', () => {
        expect(isDictationSupported()).toBe(true)
        delete global.MediaRecorder
        expect(isDictationSupported()).toBe(false)
    })
})

describe('useRambleRecorder', () => {
    test('start → data → stop delivers one base64 clip with mimeType and duration', async () => {
        // jsdom's FileReader schedules its load event through timers, so this test runs on real
        // ones; only the auto-stop test below needs the fake clock.
        jest.useRealTimers()
        const onComplete = jest.fn()
        const onError = jest.fn()
        renderHook({ onComplete, onError })

        await act(async () => {
            await hookValue.start()
        })
        expect(hookValue.isRecording).toBe(true)
        const recorder = recorderInstances[0]
        expect(recorder.mimeType).toBe('audio/webm;codecs=opus')

        act(() => {
            recorder.ondataavailable({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) })
        })
        await act(async () => {
            hookValue.stop()
            await new Promise((resolve, reject) => {
                const startedAt = Date.now()
                const poll = () => {
                    if (onComplete.mock.calls.length || onError.mock.calls.length) return resolve()
                    if (Date.now() - startedAt > 3000) return reject(new Error('FileReader never completed'))
                    setTimeout(poll, 10)
                }
                poll()
            })
        })

        expect(onError).not.toHaveBeenCalled()
        expect(onComplete).toHaveBeenCalledTimes(1)
        const payload = onComplete.mock.calls[0][0]
        expect(payload.audioBase64).toMatch(/^data:/)
        expect(payload.mimeType).toBe('audio/webm;codecs=opus')
        expect(typeof payload.durationSeconds).toBe('number')
        expect(hookValue.isRecording).toBe(false)
    })

    test('cancel discards the recording without completing', async () => {
        const onComplete = jest.fn()
        renderHook({ onComplete, onError: jest.fn() })

        await act(async () => {
            await hookValue.start()
        })
        act(() => {
            recorderInstances[0].ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })
            hookValue.cancel()
        })

        expect(hookValue.isRecording).toBe(false)
        expect(onComplete).not.toHaveBeenCalled()
        expect(recorderInstances[0].stream.tracks[0].stop).toHaveBeenCalled()
    })

    test('auto-stops at the max duration', async () => {
        const onComplete = jest.fn()
        renderHook({ onComplete, onError: jest.fn() })

        await act(async () => {
            await hookValue.start()
        })
        const recorder = recorderInstances[0]
        const stopSpy = jest.spyOn(recorder, 'stop')
        act(() => {
            recorder.ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })
            jest.advanceTimersByTime(RAMBLE_MAX_DURATION_SECONDS * 1000)
        })

        expect(stopSpy).toHaveBeenCalled()
        expect(hookValue.isRecording).toBe(false)
    })

    test('permission denial reports permission-denied and never starts', async () => {
        navigator.mediaDevices.getUserMedia.mockRejectedValue(
            Object.assign(new Error('denied'), { name: 'NotAllowedError' })
        )
        const onError = jest.fn()
        renderHook({ onComplete: jest.fn(), onError })

        await act(async () => {
            await hookValue.start()
        })

        expect(onError).toHaveBeenCalledWith('permission-denied')
        expect(hookValue.isRecording).toBe(false)
    })

    test('an oversized recording reports too-large instead of completing', async () => {
        const onComplete = jest.fn()
        const onError = jest.fn()
        renderHook({ onComplete, onError })

        await act(async () => {
            await hookValue.start()
        })
        const recorder = recorderInstances[0]
        const bigBlob = new Blob(['x'], { type: 'audio/webm' })
        Object.defineProperty(bigBlob, 'size', { value: RAMBLE_MAX_AUDIO_BYTES + 1 })
        // Blob() built from parts keeps its own size; override via a proxy chunk instead.
        act(() => {
            recorder.ondataavailable({ data: bigBlob })
        })
        const originalBlob = global.Blob
        global.Blob = class extends originalBlob {
            constructor(parts, options) {
                super(parts, options)
                Object.defineProperty(this, 'size', { value: RAMBLE_MAX_AUDIO_BYTES + 1 })
            }
        }
        await act(async () => {
            hookValue.stop()
            await Promise.resolve()
        })
        global.Blob = originalBlob

        expect(onError).toHaveBeenCalledWith('too-large')
        expect(onComplete).not.toHaveBeenCalled()
    })

    test('missing browser support reports not-supported', async () => {
        delete global.MediaRecorder
        const onError = jest.fn()
        renderHook({ onComplete: jest.fn(), onError })

        await act(async () => {
            await hookValue.start()
        })

        expect(onError).toHaveBeenCalledWith('not-supported')
    })

    test('unmount while recording stops the stream tracks', async () => {
        const root = renderHook({ onComplete: jest.fn(), onError: jest.fn() })

        await act(async () => {
            await hookValue.start()
        })
        const tracks = recorderInstances[0].stream.tracks
        act(() => {
            root.unmount()
        })

        expect(tracks[0].stop).toHaveBeenCalled()
    })
})
