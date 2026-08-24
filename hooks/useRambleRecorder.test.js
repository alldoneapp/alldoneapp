/**
 * @jest-environment jsdom
 *
 * Recorder state machine for rambler dictation: mime probing (webm → mp4, never hardcoded),
 * one-shot record/stop/cancel, the max-duration auto-stop, the size guard, and permission errors.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { readLastUsedInputDevice, readLearnedCaptureMode, readLearnedInputDevice } from './rambleMicCapture'
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

const mockTrack = () => ({ stop: jest.fn(), label: 'MacBook Pro Microphone', muted: false })

const buildStream = () => {
    const tracks = [mockTrack()]
    return { getTracks: () => tracks, getAudioTracks: () => tracks, tracks }
}

// Web Audio stand-in for the AT-2357 tests: `peakByCall` feeds one sample window per acquired
// stream, so a test can make the first (processed) capture silent and the second (raw) alive.
const installAudioContext = amplitudesPerContext => {
    let contextIndex = -1
    global.window.AudioContext = class {
        constructor() {
            contextIndex += 1
            this.amplitude = amplitudesPerContext[Math.min(contextIndex, amplitudesPerContext.length - 1)]
        }
        createMediaStreamSource() {
            return { connect() {}, disconnect() {} }
        }
        createAnalyser() {
            const amplitude = this.amplitude
            return {
                fftSize: 2048,
                getFloatTimeDomainData(buffer) {
                    buffer.fill(amplitude)
                },
            }
        }
        resume() {}
        close() {}
    }
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
    delete global.window.AudioContext
    localStorage.clear()
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

    /**
     * Push-to-talk (AT-2405) releases the button whenever it likes, including while `start()` is
     * still awaiting getUserMedia and the AT-2357 silence probe — several hundred milliseconds in
     * which no MediaRecorder exists yet. Before these guards, `stop()` found `recorderRef.current`
     * null, did nothing, and the recording then started AFTER the release with nothing left to
     * stop it: a hot microphone running to the 300s cap, invisible because the UI had already
     * gone back to idle.
     */
    describe('release before the microphone finished opening (AT-2405)', () => {
        // Hold getUserMedia open so a release can be interleaved with acquisition, the way a real
        // permission gate does.
        const deferredStream = () => {
            let release
            const gate = new Promise(resolve => {
                release = resolve
            })
            const issued = []
            navigator.mediaDevices.getUserMedia = jest.fn(async () => {
                await gate
                const stream = buildStream()
                issued.push(stream)
                return stream
            })
            return { openMic: () => release(), issued }
        }

        test('stopping mid-acquisition never starts a recorder and reports nothing', async () => {
            jest.useRealTimers()
            const { openMic } = deferredStream()
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            let pending
            act(() => {
                pending = hookValue.start()
            })
            // The user let go while the permission gate was still open.
            let delivered
            act(() => {
                delivered = hookValue.stop()
            })
            expect(delivered).toBe(false)

            await act(async () => {
                openMic()
                await pending
            })

            expect(recorderInstances).toHaveLength(0)
            expect(hookValue.isRecording).toBe(false)
            // Silent: the user held the button for a moment and nothing happened. An error here
            // would be noise, not information.
            expect(onError).not.toHaveBeenCalled()
            expect(onComplete).not.toHaveBeenCalled()
        })

        test('the microphone acquired after an abort is handed straight back', async () => {
            jest.useRealTimers()
            const { openMic, issued } = deferredStream()
            renderHook({ onComplete: jest.fn(), onError: jest.fn() })

            let pending
            act(() => {
                pending = hookValue.start()
            })
            act(() => {
                hookValue.cancel()
            })
            await act(async () => {
                openMic()
                await pending
            })

            // Leaving the track live would keep the browser's recording indicator lit with no
            // recording behind it — the user would think they were still being listened to.
            expect(issued).toHaveLength(1)
            expect(issued[0].tracks[0].stop).toHaveBeenCalled()
            expect(recorderInstances).toHaveLength(0)
        })

        test('a start issued after an abort is not itself aborted', async () => {
            jest.useRealTimers()
            renderHook({ onComplete: jest.fn(), onError: jest.fn() })

            act(() => {
                hookValue.stop()
            })
            await act(async () => {
                await hookValue.start()
            })

            expect(recorderInstances).toHaveLength(1)
            expect(hookValue.isRecording).toBe(true)
        })
    })

    describe('minimum recording duration (AT-2405)', () => {
        test('a take shorter than the minimum is discarded, not uploaded', async () => {
            jest.useRealTimers()
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            await act(async () => {
                await hookValue.start()
            })
            let delivered
            act(() => {
                recorderInstances[0].ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })
                delivered = hookValue.stop({ minDurationMs: 60000 })
            })

            expect(delivered).toBe(false)
            // Discarded exactly like Escape: nothing uploaded, no Gold spent, and no error message
            // for what was plainly an accidental press.
            expect(onComplete).not.toHaveBeenCalled()
            expect(onError).not.toHaveBeenCalled()
            expect(hookValue.isRecording).toBe(false)
            expect(recorderInstances[0].stream.tracks[0].stop).toHaveBeenCalled()
        })

        test('a take that clears the minimum is delivered normally', async () => {
            jest.useRealTimers()
            const onComplete = jest.fn()
            renderHook({ onComplete, onError: jest.fn() })

            await act(async () => {
                await hookValue.start()
            })
            let delivered
            act(() => {
                recorderInstances[0].ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) })
            })
            await act(async () => {
                delivered = hookValue.stop({ minDurationMs: 0 })
                // jsdom's FileReader delivers its load event through timers, so the completion is
                // polled for rather than assumed — same as the happy-path test above.
                await new Promise((resolve, reject) => {
                    const startedAt = Date.now()
                    const poll = () => {
                        if (onComplete.mock.calls.length) return resolve()
                        if (Date.now() - startedAt > 3000) return reject(new Error('FileReader never completed'))
                        setTimeout(poll, 10)
                    }
                    poll()
                })
            })

            expect(delivered).toBe(true)
            expect(onComplete).toHaveBeenCalled()
        })
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

    // AT-2357: a macOS capture that yields digital silence still encodes to a non-empty blob, so
    // without these checks the clip is uploaded, billed, and comes back as "No speech detected".
    describe('silent microphone (AT-2357)', () => {
        const recordAndStop = async () => {
            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })
            const recorder = recorderInstances[recorderInstances.length - 1]
            act(() => {
                recorder.ondataavailable({ data: new Blob(['silence-bytes'], { type: 'audio/webm' }) })
            })
            await act(async () => {
                hookValue.stop()
                await new Promise(resolve => setTimeout(resolve, 50))
            })
        }

        test('a silent processed capture is reported locally instead of uploaded, and remembers raw', async () => {
            // Both acquisitions are silent, so the pre-flight rescue cannot save the take and the
            // completed recording is the thing that must be caught.
            installAudioContext([0, 0])
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            await recordAndStop()

            expect(onComplete).not.toHaveBeenCalled()
            // Silent processed + silent raw ends on the raw verdict, which clears the preference
            // rather than pinning a degraded mode forever.
            expect(onError).toHaveBeenCalledWith('silent-input', expect.objectContaining({ peak: 0 }))
            expect(readLearnedCaptureMode()).toBeNull()
        })

        test('a dead processed device is re-acquired with processing disabled before recording', async () => {
            // First context (processed) silent, second (raw) alive: the rescue path.
            installAudioContext([0, 0.3])
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(1, { audio: true })
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, {
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            })
            // Silent processed AND alive raw proves the processing path is the broken one.
            expect(readLearnedCaptureMode()).toEqual(
                expect.objectContaining({ mode: 'raw', deviceLabel: 'MacBook Pro Microphone' })
            )
            expect(onError).not.toHaveBeenCalled()

            await act(async () => {
                hookValue.cancel()
            })
        })

        test('a remembered raw mode skips the probe and is dropped when raw is silent too', async () => {
            localStorage.setItem('rambler.captureMode', JSON.stringify({ mode: 'raw', deviceId: '' }))
            installAudioContext([0])
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            await recordAndStop()

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            })
            expect(onComplete).not.toHaveBeenCalled()
            expect(onError).toHaveBeenCalledWith('silent-input', expect.any(Object))
            expect(readLearnedCaptureMode()).toBeNull()
        })

        test('audible speech uploads normally and leaves the processed mode alone', async () => {
            installAudioContext([0.25])
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })
            const recorder = recorderInstances[0]
            act(() => {
                recorder.ondataavailable({ data: new Blob(['speech-bytes'], { type: 'audio/webm' }) })
            })
            await act(async () => {
                hookValue.stop()
                await new Promise(resolve => setTimeout(resolve, 80))
            })

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
            expect(onError).not.toHaveBeenCalled()
            expect(onComplete).toHaveBeenCalledTimes(1)
            expect(readLearnedCaptureMode()).toBeNull()
        })

        // The follow-up half of AT-2357: the browser's microphone choice is NOT the system input
        // source, so the device it hands us can simply be the wrong one — and no capture setting
        // can make a dead device produce audio.
        const deviceStream = (deviceId, label) => {
            const tracks = [
                {
                    stop: jest.fn(),
                    label,
                    muted: false,
                    getSettings: () => ({ deviceId, groupId: `g-${deviceId}` }),
                },
            ]
            return { getTracks: () => tracks, getAudioTracks: () => tracks, tracks }
        }

        const installDevices = () => {
            navigator.mediaDevices.getUserMedia = jest.fn(async constraints =>
                constraints?.audio?.deviceId?.exact === 'webcam-1'
                    ? deviceStream('webcam-1', 'HD Webcam')
                    : deviceStream('builtin-1', 'MacBook Pro Microphone')
            )
            navigator.mediaDevices.enumerateDevices = jest.fn(async () => [
                {
                    kind: 'audioinput',
                    deviceId: 'default',
                    label: 'Default - MacBook Pro Microphone',
                    groupId: 'g-builtin-1',
                },
                { kind: 'audioinput', deviceId: 'builtin-1', label: 'MacBook Pro Microphone', groupId: 'g-builtin-1' },
                { kind: 'audioinput', deviceId: 'webcam-1', label: 'HD Webcam', groupId: 'g-webcam-1' },
            ])
        }

        test('a microphone that is dead both ways is escaped by recording from another input', async () => {
            installDevices()
            // built-in silent processed, silent raw, webcam alive.
            installAudioContext([0, 0, 0.3])
            const onError = jest.fn()
            renderHook({ onComplete: jest.fn(), onError })

            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })

            const calls = navigator.mediaDevices.getUserMedia.mock.calls
            expect(calls).toHaveLength(3)
            // The rescue on the original device is PINNED to it...
            expect(calls[1][0].audio.deviceId).toEqual({ exact: 'builtin-1' })
            // ...and only then do we move to a different microphone, never the alias entry pointing
            // back at the device we just measured.
            expect(calls[2][0].audio.deviceId).toEqual({ exact: 'webcam-1' })
            expect(readLearnedInputDevice()).toEqual({ deviceId: 'webcam-1', label: 'HD Webcam' })
            expect(onError).not.toHaveBeenCalled()

            await act(async () => {
                hookValue.cancel()
            })
        })

        test('the device actually recorded from is remembered for the settings picker', async () => {
            installDevices()
            installAudioContext([0.3])
            renderHook({ onComplete: jest.fn(), onError: jest.fn() })

            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })

            // A user who cannot open DevTools has no other way to see that "System default" is the
            // built-in microphone rather than the one selected in macOS.
            expect(readLastUsedInputDevice()).toEqual({ deviceId: 'builtin-1', label: 'MacBook Pro Microphone' })

            await act(async () => {
                hookValue.cancel()
            })
        })

        test('when every microphone is silent the message can name what was tried', async () => {
            installDevices()
            installAudioContext([0])
            const onComplete = jest.fn()
            const onError = jest.fn()
            renderHook({ onComplete, onError })

            await recordAndStop()

            expect(onComplete).not.toHaveBeenCalled()
            expect(onError).toHaveBeenCalledWith(
                'silent-input',
                expect.objectContaining({ triedDeviceLabels: ['MacBook Pro Microphone', 'HD Webcam'] })
            )
            // Nothing worked, so nothing is remembered — the next take starts from a clean slate
            // instead of pinning a device that is just as dead.
            expect(readLearnedInputDevice()).toBeNull()
            expect(readLearnedCaptureMode()).toBeNull()
        })

        test('a muted track is rescued without waiting for the probe timeout', async () => {
            navigator.mediaDevices.getUserMedia = jest.fn(async () => {
                const stream = buildStream()
                stream.tracks[0].muted = navigator.mediaDevices.getUserMedia.mock.calls.length === 1
                return stream
            })
            installAudioContext([0.2, 0.2])
            renderHook({ onComplete: jest.fn(), onError: jest.fn() })

            jest.useRealTimers()
            await act(async () => {
                await hookValue.start()
            })

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
            await act(async () => {
                hookValue.cancel()
            })
        })
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
