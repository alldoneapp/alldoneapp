/**
 * @jest-environment jsdom
 *
 * Silent-microphone detection for rambler dictation (AT-2357): constraint building, the remembered
 * capture mode, the peak monitor, the pre-flight signal probe, and the silence verdict — including
 * the two ways it must FAIL OPEN (no Web Audio, unmeasurable peak), because a false "silent"
 * verdict would throw away a recording the user actually made.
 */
import {
    CAPTURE_MODE_PROCESSED,
    CAPTURE_MODE_RAW,
    SILENT_PEAK_THRESHOLD,
    buildAudioConstraints,
    createInputLevelMonitor,
    getInputDeviceLabel,
    isSilentCapture,
    isTrackMuted,
    readPreferredCaptureMode,
    waitForInputSignal,
    writePreferredCaptureMode,
} from './rambleMicCapture'

const buildStream = (overrides = {}) => ({
    getAudioTracks: () => [{ label: 'MacBook Pro Microphone', muted: false, ...overrides }],
    getTracks: () => [{ stop: jest.fn() }],
})

// Minimal Web Audio stand-in: `samples` is what the analyser hands back on each read.
const installAudioContext = samples => {
    const closed = { value: false }
    global.window.AudioContext = class {
        createMediaStreamSource() {
            return { connect() {}, disconnect() {} }
        }
        createAnalyser() {
            return {
                fftSize: 2048,
                getFloatTimeDomainData(buffer) {
                    const next = typeof samples === 'function' ? samples() : samples
                    for (let index = 0; index < buffer.length; index += 1) {
                        buffer[index] = next[index % next.length]
                    }
                },
            }
        }
        resume() {}
        close() {
            closed.value = true
        }
    }
    return closed
}

afterEach(() => {
    delete global.window.AudioContext
    delete global.window.webkitAudioContext
    localStorage.clear()
})

describe('buildAudioConstraints', () => {
    test('processed keeps the browser defaults, raw disables the processing chain', () => {
        expect(buildAudioConstraints(CAPTURE_MODE_PROCESSED)).toBe(true)
        expect(buildAudioConstraints(CAPTURE_MODE_RAW)).toEqual({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        })
    })
})

describe('capture mode preference', () => {
    test('defaults to processed, round-trips raw, and clears back to processed', () => {
        expect(readPreferredCaptureMode()).toBe(CAPTURE_MODE_PROCESSED)
        writePreferredCaptureMode(CAPTURE_MODE_RAW)
        expect(readPreferredCaptureMode()).toBe(CAPTURE_MODE_RAW)
        writePreferredCaptureMode(CAPTURE_MODE_PROCESSED)
        expect(readPreferredCaptureMode()).toBe(CAPTURE_MODE_PROCESSED)
    })

    test('survives storage that throws (Safari private mode)', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied')
        })
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied')
        })
        expect(readPreferredCaptureMode()).toBe(CAPTURE_MODE_PROCESSED)
        expect(() => writePreferredCaptureMode(CAPTURE_MODE_RAW)).not.toThrow()
        getItem.mockRestore()
        setItem.mockRestore()
    })
})

describe('track inspection', () => {
    test('reads the device label and the muted flag, tolerating a stream without tracks', () => {
        expect(getInputDeviceLabel(buildStream())).toBe('MacBook Pro Microphone')
        expect(getInputDeviceLabel(null)).toBe('')
        expect(isTrackMuted(buildStream({ muted: true }))).toBe(true)
        expect(isTrackMuted(buildStream())).toBe(false)
        expect(isTrackMuted(null)).toBe(false)
    })
})

describe('createInputLevelMonitor', () => {
    test('returns null without Web Audio so callers treat the capture as healthy', () => {
        expect(createInputLevelMonitor(buildStream())).toBeNull()
    })

    test('tracks the running peak amplitude across samples', () => {
        let current = [0, 0, 0]
        installAudioContext(() => current)
        const monitor = createInputLevelMonitor(buildStream())

        expect(monitor.sample()).toBe(0)
        expect(monitor.hasSignal()).toBe(false)
        current = [0.2, -0.4, 0.1]
        expect(monitor.sample()).toBeCloseTo(0.4)
        // The peak is a high-water mark: a later quiet window cannot erase captured speech.
        current = [0, 0, 0]
        expect(monitor.sample()).toBeCloseTo(0.4)
        expect(monitor.hasSignal()).toBe(true)
    })

    test('close() releases the audio context once', () => {
        const closed = installAudioContext([0.1])
        const monitor = createInputLevelMonitor(buildStream())
        monitor.close()
        expect(closed.value).toBe(true)
        expect(() => monitor.close()).not.toThrow()
    })
})

describe('waitForInputSignal', () => {
    test('resolves true as soon as any energy appears', async () => {
        installAudioContext([0, 0.000001, 0])
        const monitor = createInputLevelMonitor(buildStream())
        await expect(waitForInputSignal(monitor, { timeoutMs: 200, pollMs: 5 })).resolves.toBe(true)
    })

    test('resolves false for a device delivering bit-exact silence', async () => {
        installAudioContext([0, 0, 0])
        const monitor = createInputLevelMonitor(buildStream())
        await expect(waitForInputSignal(monitor, { timeoutMs: 60, pollMs: 5 })).resolves.toBe(false)
    })

    test('resolves true when there is no monitor at all', async () => {
        await expect(waitForInputSignal(null)).resolves.toBe(true)
    })
})

describe('isSilentCapture', () => {
    test('an unmeasurable peak is never silent', () => {
        expect(isSilentCapture(null)).toBe(false)
        expect(isSilentCapture(undefined)).toBe(false)
    })

    test('separates digital silence from a genuinely quiet but real recording', () => {
        expect(isSilentCapture(0)).toBe(true)
        expect(isSilentCapture(SILENT_PEAK_THRESHOLD / 2)).toBe(true)
        expect(isSilentCapture(0.002)).toBe(false)
        expect(isSilentCapture(0.3)).toBe(false)
    })
})
