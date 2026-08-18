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
    MAX_FALLBACK_DEVICES,
    MIC_MODE_AUTO,
    MIC_MODE_COMPATIBILITY,
    MIC_MODE_STANDARD,
    SILENT_PEAK_THRESHOLD,
    acquireDictationStream,
    buildAudioConstraints,
    createInputLevelMonitor,
    forgetLearnedCaptureMode,
    getInputDeviceId,
    getInputDeviceLabel,
    installDeviceChangeInvalidation,
    isSilentCapture,
    isTrackMuted,
    isWorkaroundActive,
    listAudioInputDevices,
    readLearnedCaptureMode,
    readLearnedInputDevice,
    readMicModeSetting,
    readPreferredInputDevice,
    rememberLearnedCaptureMode,
    rememberLearnedInputDevice,
    waitForInputSignal,
    writeMicModeSetting,
    writePreferredInputDevice,
} from './rambleMicCapture'

const buildStream = (overrides = {}) => {
    const { deviceId = 'default', groupId = '', ...trackOverrides } = overrides
    return {
        getAudioTracks: () => [
            {
                label: 'MacBook Pro Microphone',
                muted: false,
                getSettings: () => ({ deviceId, groupId }),
                ...trackOverrides,
            },
        ],
        getTracks: () => [{ stop: jest.fn() }],
    }
}

const RAW_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

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
        expect(buildAudioConstraints(CAPTURE_MODE_RAW)).toEqual(RAW_CONSTRAINTS)
    })

    test('a device is pinned with `exact`, never merely preferred', () => {
        // `ideal` would let the browser silently substitute another microphone, which is the exact
        // failure this constraint exists to prevent.
        expect(buildAudioConstraints(CAPTURE_MODE_PROCESSED, 'webcam-1')).toEqual({
            deviceId: { exact: 'webcam-1' },
        })
        expect(buildAudioConstraints(CAPTURE_MODE_RAW, 'webcam-1')).toEqual({
            deviceId: { exact: 'webcam-1' },
            ...RAW_CONSTRAINTS,
        })
    })
})

describe('mic mode setting and the learned workaround', () => {
    test('defaults to automatic with nothing learned', () => {
        expect(readMicModeSetting()).toBe(MIC_MODE_AUTO)
        expect(readLearnedCaptureMode()).toBeNull()
        expect(isWorkaroundActive()).toBe(false)
    })

    test('the learned record round-trips with its device and clears again', () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1', deviceLabel: 'HD Webcam' })
        expect(readLearnedCaptureMode()).toEqual({
            mode: CAPTURE_MODE_RAW,
            deviceId: 'webcam-1',
            deviceLabel: 'HD Webcam',
        })
        expect(isWorkaroundActive()).toBe(true)
        forgetLearnedCaptureMode()
        expect(readLearnedCaptureMode()).toBeNull()
    })

    test('a legacy plain-string record still reads as raw, without a device', () => {
        localStorage.setItem('rambler.captureMode', 'raw')
        expect(readLearnedCaptureMode()).toEqual({ mode: CAPTURE_MODE_RAW, deviceId: '', deviceLabel: '' })
    })

    test('a corrupt record is ignored rather than throwing', () => {
        localStorage.setItem('rambler.captureMode', '{not json')
        expect(readLearnedCaptureMode()).toBeNull()
    })

    test('choosing a mode by hand discards what automatic had learned', () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        writeMicModeSetting(MIC_MODE_STANDARD)
        expect(readMicModeSetting()).toBe(MIC_MODE_STANDARD)
        expect(readLearnedCaptureMode()).toBeNull()
        // An explicit setting is not "the workaround is on" even when it selects the same capture.
        writeMicModeSetting(MIC_MODE_COMPATIBILITY)
        expect(isWorkaroundActive()).toBe(false)
        writeMicModeSetting(MIC_MODE_AUTO)
        expect(readMicModeSetting()).toBe(MIC_MODE_AUTO)
    })

    test('survives storage that throws (Safari private mode)', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied')
        })
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied')
        })
        expect(readMicModeSetting()).toBe(MIC_MODE_AUTO)
        expect(readLearnedCaptureMode()).toBeNull()
        expect(() => rememberLearnedCaptureMode({ deviceId: 'x' })).not.toThrow()
        getItem.mockRestore()
        setItem.mockRestore()
    })
})

describe('input device preference', () => {
    test('the chosen device round-trips and clears back to the browser default', () => {
        expect(readPreferredInputDevice()).toBeNull()
        writePreferredInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })
        expect(readPreferredInputDevice()).toEqual({ deviceId: 'webcam-1', label: 'HD Webcam' })
        writePreferredInputDevice(null)
        expect(readPreferredInputDevice()).toBeNull()
    })

    test('choosing a device by hand discards everything automatic had learned', () => {
        rememberLearnedCaptureMode({ deviceId: 'builtin-1' })
        rememberLearnedInputDevice({ deviceId: 'builtin-1', label: 'Built-in' })

        writePreferredInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })

        expect(readLearnedCaptureMode()).toBeNull()
        expect(readLearnedInputDevice()).toBeNull()
    })

    test('a record without a device id is not a selection', () => {
        localStorage.setItem('rambler.micDevice', JSON.stringify({ label: 'Ghost' }))
        expect(readPreferredInputDevice()).toBeNull()
        localStorage.setItem('rambler.inputDevice', '{not json')
        expect(readLearnedInputDevice()).toBeNull()
    })
})

describe('listAudioInputDevices', () => {
    const withMediaDevices = async (mediaDevices, assertion) => {
        const original = navigator.mediaDevices
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
        try {
            await assertion()
        } finally {
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original })
        }
    }

    test('returns only audio inputs, and an empty list rather than throwing', async () => {
        await withMediaDevices(
            {
                enumerateDevices: async () => [
                    { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic', groupId: 'g1' },
                    { kind: 'videoinput', deviceId: 'cam-1', label: 'Cam', groupId: 'g2' },
                    { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers', groupId: 'g3' },
                ],
            },
            async () => {
                await expect(listAudioInputDevices()).resolves.toEqual([
                    { deviceId: 'mic-1', label: 'Mic', groupId: 'g1' },
                ])
            }
        )

        await withMediaDevices(
            {
                enumerateDevices: async () => {
                    throw new Error('not allowed')
                },
            },
            async () => {
                await expect(listAudioInputDevices()).resolves.toEqual([])
            }
        )

        // No mediaDevices at all (jsdom, insecure origin) must not throw either.
        await expect(listAudioInputDevices()).resolves.toEqual([])
    })
})

describe('installDeviceChangeInvalidation', () => {
    test('a device change retires the learned workaround', () => {
        const listeners = {}
        const mediaDevices = {
            addEventListener: (type, handler) => {
                listeners[type] = handler
            },
            removeEventListener: () => {},
        }
        const original = navigator.mediaDevices
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })

        const uninstall = installDeviceChangeInvalidation()
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        rememberLearnedInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })
        listeners.devicechange()
        expect(readLearnedCaptureMode()).toBeNull()
        // The learned DEVICE has to go too: plugging in headphones is exactly when "record from the
        // webcam instead" stops being the right answer.
        expect(readLearnedInputDevice()).toBeNull()

        uninstall()
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original })
    })

    test('refcounts, so one unmounted recorder cannot silence the others', () => {
        const listeners = {}
        const removeEventListener = jest.fn()
        const mediaDevices = {
            addEventListener: (type, handler) => {
                listeners[type] = handler
            },
            removeEventListener,
        }
        const original = navigator.mediaDevices
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })

        // A RambleButton sits next to essentially every text input, so several install at once.
        const first = installDeviceChangeInvalidation()
        const second = installDeviceChangeInvalidation()

        first()
        expect(removeEventListener).not.toHaveBeenCalled()
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        listeners.devicechange()
        expect(readLearnedCaptureMode()).toBeNull()

        second()
        expect(removeEventListener).toHaveBeenCalledTimes(1)
        // A double release must not drive the refcount negative and wedge the next install.
        second()
        expect(removeEventListener).toHaveBeenCalledTimes(1)
        installDeviceChangeInvalidation()()

        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original })
    })
})

describe('track inspection', () => {
    test('reads the device label and the muted flag, tolerating a stream without tracks', () => {
        expect(getInputDeviceLabel(buildStream())).toBe('MacBook Pro Microphone')
        expect(getInputDeviceLabel(null)).toBe('')
        expect(getInputDeviceId(buildStream({ deviceId: 'webcam-1' }))).toBe('webcam-1')
        expect(getInputDeviceId(null)).toBe('')
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

describe('acquireDictationStream', () => {
    // One AudioContext is created per acquired stream, so the amplitude list maps 1:1 onto the
    // acquisitions a case is expected to make: [processed, raw] etc.
    const acquire = (amplitudes, options = {}) => {
        let index = -1
        global.window.AudioContext = class {
            constructor() {
                index += 1
                this.amplitude = amplitudes[Math.min(index, amplitudes.length - 1)]
            }
            createMediaStreamSource() {
                return { connect() {}, disconnect() {} }
            }
            createAnalyser() {
                const amplitude = this.amplitude
                return {
                    fftSize: 2048,
                    getFloatTimeDomainData: buffer => buffer.fill(amplitude),
                }
            }
            resume() {}
            close() {}
        }
        // `streams` (when given) maps 1:1 onto the acquisitions, so a case can hand back a different
        // device per call — which is what the walk across inputs is made of.
        let call = -1
        const requestStream = jest.fn(async constraints => {
            call += 1
            const requestedId = constraints?.deviceId?.exact
            if (options.unavailableDeviceIds?.includes(requestedId)) {
                const error = new Error('device gone')
                error.name = 'OverconstrainedError'
                throw error
            }
            const overrides = options.streams
                ? options.streams[Math.min(call, options.streams.length - 1)]
                : options.streamOverrides
            return buildStream(overrides)
        })
        return { requestStream, run: () => acquireDictationStream({ requestStream, ...options.args }) }
    }

    test('a healthy device is acquired once with the browser defaults', async () => {
        const { requestStream, run } = acquire([0.3])
        const result = await run()

        expect(requestStream).toHaveBeenCalledTimes(1)
        expect(requestStream).toHaveBeenCalledWith(true)
        expect(result.captureMode).toBe(CAPTURE_MODE_PROCESSED)
        expect(readLearnedCaptureMode()).toBeNull()
    })

    test('a silent device is re-acquired raw before recording and the fix is remembered', async () => {
        const { requestStream, run } = acquire([0, 0.3], { streamOverrides: { deviceId: 'webcam-1' } })
        const result = await run()

        expect(requestStream).toHaveBeenCalledTimes(2)
        // PINNED to the device we just measured: an unconstrained second call is free to resolve to
        // different hardware, which would make the probe's verdict about one mic and the recording
        // about another.
        expect(requestStream).toHaveBeenNthCalledWith(2, { deviceId: { exact: 'webcam-1' }, ...RAW_CONSTRAINTS })
        expect(result.captureMode).toBe(CAPTURE_MODE_RAW)
        expect(readLearnedCaptureMode()).toEqual(
            expect.objectContaining({ mode: CAPTURE_MODE_RAW, deviceId: 'webcam-1' })
        )
    })

    test('silent processed AND silent raw is not attributed to the processing path', async () => {
        const { run } = acquire([0, 0], { args: { enumerateDevices: async () => [] } })
        const result = await run()

        expect(result.captureMode).toBe(CAPTURE_MODE_RAW)
        // Nothing proved the workaround helps, so nothing is remembered for next time.
        expect(readLearnedCaptureMode()).toBeNull()
        expect(result.switchedDevice).toBe(false)
    })

    test('a remembered workaround is reused without probing while the device is the same', async () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        const { requestStream, run } = acquire([0.3], { streamOverrides: { deviceId: 'webcam-1' } })
        const result = await run()

        expect(requestStream).toHaveBeenCalledTimes(1)
        expect(requestStream).toHaveBeenCalledWith({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        })
        expect(result.captureMode).toBe(CAPTURE_MODE_RAW)
    })

    test('a different microphone gets a fresh verdict instead of inheriting the workaround', async () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        const { requestStream, run } = acquire([0.3, 0.3], { streamOverrides: { deviceId: 'airpods-2' } })
        const result = await run()

        // First call honours the remembered raw mode, then the device mismatch is detected and the
        // healthy default is restored — the workaround does not outlive the hardware.
        expect(requestStream).toHaveBeenCalledTimes(2)
        expect(requestStream).toHaveBeenNthCalledWith(2, true)
        expect(result.captureMode).toBe(CAPTURE_MODE_PROCESSED)
        expect(readLearnedCaptureMode()).toBeNull()
    })

    test('an explicit setting is obeyed as written: no probe, no learning', async () => {
        const standard = acquire([0], { args: { setting: MIC_MODE_STANDARD } })
        const standardResult = await standard.run()
        expect(standard.requestStream).toHaveBeenCalledTimes(1)
        expect(standard.requestStream).toHaveBeenCalledWith(true)
        expect(standardResult.captureMode).toBe(CAPTURE_MODE_PROCESSED)
        expect(readLearnedCaptureMode()).toBeNull()

        const compatibility = acquire([0.3], { args: { setting: MIC_MODE_COMPATIBILITY } })
        const compatibilityResult = await compatibility.run()
        expect(compatibility.requestStream).toHaveBeenCalledTimes(1)
        expect(compatibilityResult.captureMode).toBe(CAPTURE_MODE_RAW)
    })

    test('a muted track is rescued without waiting out the probe', async () => {
        const { requestStream, run } = acquire([0.3, 0.3], { streamOverrides: { muted: true } })
        const result = await run()

        expect(requestStream).toHaveBeenCalledTimes(2)
        expect(result.captureMode).toBe(CAPTURE_MODE_RAW)
    })

    test('a dead device is escaped by recording from another input, which is remembered', async () => {
        // The reported failure: the browser hands us the built-in mic (silent both ways) while the
        // microphone the user actually selected sits right next to it in the device list.
        const { requestStream, run } = acquire([0, 0, 0.3], {
            streams: [
                { deviceId: 'builtin-1', groupId: 'g-builtin' },
                { deviceId: 'builtin-1', groupId: 'g-builtin' },
                { deviceId: 'webcam-1', groupId: 'g-webcam', label: 'HD Webcam' },
            ],
            args: {
                enumerateDevices: async () => [
                    { deviceId: 'default', label: 'Default - MacBook Pro Microphone', groupId: 'g-builtin' },
                    { deviceId: 'builtin-1', label: 'MacBook Pro Microphone', groupId: 'g-builtin' },
                    { deviceId: 'webcam-1', label: 'HD Webcam', groupId: 'g-webcam' },
                ],
            },
        })
        const result = await run()

        // The alias entry and the device we already measured are not re-tested; only the webcam is.
        expect(requestStream).toHaveBeenCalledTimes(3)
        expect(requestStream).toHaveBeenNthCalledWith(3, { deviceId: { exact: 'webcam-1' }, ...RAW_CONSTRAINTS })
        expect(result.switchedDevice).toBe(true)
        expect(result.deviceId).toBe('webcam-1')
        expect(readLearnedInputDevice()).toEqual({ deviceId: 'webcam-1', label: 'HD Webcam' })
        // Next recording starts on the working device instead of paying the walk again.
        expect(readLearnedCaptureMode()).toEqual(expect.objectContaining({ deviceId: 'webcam-1' }))
        expect(result.triedDevices.map(device => device.deviceId)).toEqual(['builtin-1', 'webcam-1'])
    })

    test('a device that cannot be opened only costs its own turn in the walk', async () => {
        const { requestStream, run } = acquire([0, 0, 0.3], {
            unavailableDeviceIds: ['busy-1'],
            streams: [{ deviceId: 'builtin-1' }, { deviceId: 'builtin-1' }, { deviceId: 'webcam-1', label: 'Webcam' }],
            args: {
                enumerateDevices: async () => [
                    { deviceId: 'busy-1', label: 'Busy mic', groupId: 'g-busy' },
                    { deviceId: 'webcam-1', label: 'Webcam', groupId: 'g-webcam' },
                ],
            },
        })
        const result = await run()

        // The busy device raised OverconstrainedError; the walk moved on rather than aborting, and
        // the pinned retry that would have re-measured the built-in mic never happened.
        expect(result.switchedDevice).toBe(true)
        expect(result.deviceId).toBe('webcam-1')
        expect(requestStream).toHaveBeenCalledTimes(4)
    })

    test('the walk stops after MAX_FALLBACK_DEVICES so a broken machine cannot stall the user', async () => {
        const { requestStream, run } = acquire([0], {
            streams: [{ deviceId: 'builtin-1' }],
            args: {
                enumerateDevices: async () =>
                    Array.from({ length: 8 }, (unused, index) => ({
                        deviceId: `mic-${index}`,
                        label: `Mic ${index}`,
                        groupId: `g-${index}`,
                    })),
            },
        })
        const result = await run()

        // processed + pinned raw on the original device, then at most three candidates.
        expect(requestStream).toHaveBeenCalledTimes(2 + MAX_FALLBACK_DEVICES)
        expect(result.switchedDevice).toBe(false)
        expect(readLearnedInputDevice()).toBeNull()
    })

    test('a device chosen by hand is used, and never walked away from', async () => {
        writePreferredInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })
        const enumerateDevices = jest.fn(async () => [{ deviceId: 'builtin-1', label: 'Built-in', groupId: 'g-b' }])
        const { requestStream, run } = acquire([0, 0], {
            streams: [{ deviceId: 'webcam-1' }],
            args: { enumerateDevices },
        })
        const result = await run()

        expect(requestStream).toHaveBeenNthCalledWith(1, { deviceId: { exact: 'webcam-1' } })
        // Silent both ways, but an explicit choice is obeyed as written: no other device is opened.
        expect(enumerateDevices).not.toHaveBeenCalled()
        expect(result.switchedDevice).toBe(false)
        expect(result.captureMode).toBe(CAPTURE_MODE_RAW)
    })

    test('a remembered device that is gone falls back instead of failing the recording', async () => {
        rememberLearnedInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })
        const { requestStream, run } = acquire([0.3], {
            unavailableDeviceIds: ['webcam-1'],
            streams: [{ deviceId: 'builtin-1' }],
        })
        const result = await run()

        expect(requestStream).toHaveBeenNthCalledWith(1, { deviceId: { exact: 'webcam-1' } })
        expect(requestStream).toHaveBeenNthCalledWith(2, true)
        expect(result.deviceId).toBe('builtin-1')
        // The unplugged device is not remembered any longer.
        expect(readLearnedInputDevice()).toBeNull()
    })

    test('a getUserMedia rejection that is not about the device still reaches the caller', async () => {
        const requestStream = jest.fn(async () => {
            const error = new Error('denied')
            error.name = 'NotAllowedError'
            throw error
        })
        await expect(acquireDictationStream({ requestStream })).rejects.toThrow('denied')
    })

    test('without Web Audio the capture is treated as healthy and left alone', async () => {
        const requestStream = jest.fn(async () => buildStream())
        const result = await acquireDictationStream({ requestStream })

        expect(requestStream).toHaveBeenCalledTimes(1)
        expect(result.captureMode).toBe(CAPTURE_MODE_PROCESSED)
        expect(result.monitor).toBeNull()
    })
})
