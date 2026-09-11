import { acquireVoiceMicrophone, createVoiceMicrophoneSelector, microphoneScore } from './assistantVoiceMicrophone'
import { createInputLevelMonitor, listAudioInputDevices } from '../../hooks/rambleMicCapture'
jest.mock('../../hooks/rambleMicCapture', () => ({
    createInputLevelMonitor: jest.fn(),
    listAudioInputDevices: jest.fn(),
    getInputDeviceId: stream => stream.id,
    getInputDeviceLabel: stream => stream.id,
    getInputGroupId: stream => `group-${stream.id}`,
}))
let inputs, monitors, selector
const makeInput = (id, level) => {
    const input = { id, level }
    const track = {
        readyState: 'live',
        muted: false,
        stop: jest.fn(() => {
            track.readyState = 'ended'
        }),
    }
    input.getAudioTracks = input.getTracks = () => [track]
    return input
}
beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.clear()
    jest.clearAllMocks()
    inputs = { builtin: makeInput('builtin', 0.02), usb: makeInput('usb', 0.3) }
    monitors = []
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: jest.fn(async ({ audio }) => inputs[audio?.deviceId?.exact || 'builtin']),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        },
    })
    listAudioInputDevices.mockResolvedValue([
        { deviceId: 'default' },
        { deviceId: 'builtin', groupId: 'group-builtin' },
        { deviceId: 'usb', groupId: 'group-usb' },
    ])
    createInputLevelMonitor.mockImplementation(stream => {
        let peak = 0,
            level = 0
        const monitor = {
            close: jest.fn(),
            sample: () => {
                level = stream.level
                peak = Math.max(peak, level)
                return peak
            },
            getLevel: () => level,
            getPeak: () => peak,
        }
        monitors.push(monitor)
        return monitor
    })
})
afterEach(() => {
    selector?.stop()
    selector = null
    jest.clearAllTimers()
    jest.useRealTimers()
})
const start = async (options = {}) => {
    const capture = await acquireVoiceMicrophone()
    const onSwitch = jest.fn(async () => {})
    selector = createVoiceMicrophoneSelector({ stream: capture.stream, onSwitch, ...options })
    await jest.advanceTimersByTimeAsync(1500)
    return onSwitch
}
test('starts immediately without enumerating or asking the user to speak', async () => {
    expect((await acquireVoiceMicrophone()).stream).toBe(inputs.builtin)
    expect(listAudioInputDevices).not.toHaveBeenCalled()
    expect(createInputLevelMonitor).not.toHaveBeenCalled()
})
test.each(['iPhone', 'Android'])('retains the system headset/speaker route on %s', async userAgent => {
    const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    try {
        const headset = makeInput('bluetooth-headset', 0.01)
        navigator.mediaDevices.getUserMedia.mockResolvedValue(headset)
        const change = await start()
        await jest.advanceTimersByTimeAsync(15000)
        expect(selector.getSnapshot()).toMatchObject({ label: 'bluetooth-headset', available: true })
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
        expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].audio.deviceId).toBeUndefined()
        expect(listAudioInputDevices).not.toHaveBeenCalled()
        expect(change).not.toHaveBeenCalled()
        expect(headset.getTracks()[0].stop).not.toHaveBeenCalled()
    } finally {
        agent.mockRestore()
    }
})
test('switches during the call and later follows the louder microphone in the other direction', async () => {
    const change = await start()
    expect(change).toHaveBeenLastCalledWith(inputs.usb)
    inputs.builtin.level = 0.5
    inputs.usb.level = 0.01
    await jest.advanceTimersByTimeAsync(2000)
    expect(change).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(2500)
    expect(change).toHaveBeenLastCalledWith(inputs.builtin)
    // Both are needed to keep comparing during the call.
    expect(inputs.usb.getTracks()[0].stop).not.toHaveBeenCalled()
    selector.stop()
    expect(Object.values(inputs).every(s => s.getTracks()[0].stop.mock.calls.length === 1)).toBe(true)
    expect(monitors.every(m => m.close.mock.calls.length === 1)).toBe(true)
})
test('a transient click or a small difference does not cause switching', async () => {
    inputs.usb.level = 0.025
    const change = await start()
    inputs.usb.level = 1
    await jest.advanceTimersByTimeAsync(100)
    inputs.usb.level = 0.025
    await jest.advanceTimersByTimeAsync(5000)
    expect(change).not.toHaveBeenCalled()
    expect(microphoneScore([0, 0, 0, 0, 1])).toBe(0)
})
test('does not switch while Anna is speaking or the call is backgrounded', async () => {
    let paused = false
    const change = await start({ isPaused: () => paused })
    paused = true
    inputs.builtin.level = 0.7
    await jest.advanceTimersByTimeAsync(6000)
    expect(change).toHaveBeenCalledTimes(1)
    paused = false
    await jest.advanceTimersByTimeAsync(1500)
    expect(change).toHaveBeenLastCalledWith(inputs.builtin)
})
test('skips denied candidates and stops late captures after cleanup', async () => {
    let resolveUsb
    navigator.mediaDevices.getUserMedia.mockImplementation(({ audio }) =>
        audio.deviceId
            ? new Promise(r => {
                  resolveUsb = r
              })
            : Promise.resolve(inputs.builtin)
    )
    const change = await start()
    await jest.advanceTimersByTimeAsync(1500)
    selector.stop()
    resolveUsb(inputs.usb)
    await Promise.resolve()
    expect(inputs.usb.getTracks()[0].stop).toHaveBeenCalledTimes(1)
    expect(change).not.toHaveBeenCalled()
})
test('recovers digital silence during the call with fresh unprocessed capture', async () => {
    listAudioInputDevices.mockResolvedValue([])
    inputs.builtin.level = 0
    const raw = makeInput('builtin', 0.2)
    navigator.mediaDevices.getUserMedia.mockImplementation(async ({ audio }) =>
        audio.echoCancellation === false ? raw : inputs.builtin
    )
    const change = await start()
    await jest.advanceTimersByTimeAsync(3500)
    expect(change).toHaveBeenLastCalledWith(raw)
    expect(inputs.builtin.getTracks()[0].stop).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(100)
    expect((await acquireVoiceMicrophone()).raw).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({
            audio: expect.objectContaining({ echoCancellation: false, deviceId: { exact: 'builtin' } }),
        })
    )
})
test('stops a microphone whose permission resolves after cancellation', async () => {
    await expect(acquireVoiceMicrophone({ isCancelled: () => true })).rejects.toThrow('voice_start_cancelled')
    expect(inputs.builtin.getTracks()[0].stop).toHaveBeenCalledTimes(1)
})

test('meters the selected input while comparison is paused and follows silence immediately', async () => {
    let paused = false
    const change = await start({ isPaused: () => paused })
    expect(selector.getSnapshot()).toMatchObject({ label: 'usb', level: 0.3, available: true })
    paused = true
    inputs.usb.level = 0
    inputs.builtin.level = 0.8
    await jest.advanceTimersByTimeAsync(1500)
    expect(selector.getSnapshot().level).toBe(0)
    expect(change).toHaveBeenCalledTimes(1)
})

test('reuses the last working desktop input on the next call and falls back when it is unplugged', async () => {
    await start()
    expect((await acquireVoiceMicrophone()).deviceLabel).toBe('usb')
    navigator.mediaDevices.getUserMedia.mockImplementation(async ({ audio }) => {
        if (audio.deviceId?.exact) throw Object.assign(new Error('Device removed'), { name: 'NotFoundError' })
        return inputs.builtin
    })
    expect((await acquireVoiceMicrophone()).deviceLabel).toBe('builtin')
})

test('does not mistake a suspended analyser for a digitally silent microphone', async () => {
    listAudioInputDevices.mockResolvedValue([])
    const monitor = {
        ready: Promise.resolve(),
        isRunning: () => false,
        sample: jest.fn(),
        getLevel: () => 0,
        getPeak: () => 0,
        close: jest.fn(),
    }
    createInputLevelMonitor.mockReturnValue(monitor)
    const change = await start()
    await jest.advanceTimersByTimeAsync(10000)
    expect(selector.getSnapshot().available).toBe(false)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    expect(change).not.toHaveBeenCalled()
})

test('prepares a working input before releasing startup and bounds warmup when metering is suspended', async () => {
    const capture = await acquireVoiceMicrophone()
    const onSwitch = jest.fn(async () => {})
    selector = createVoiceMicrophoneSelector({ stream: capture.stream, onSwitch })
    let prepared = false
    const preparation = selector.whenPrepared().then(result => {
        prepared = result
    })
    await jest.advanceTimersByTimeAsync(500)
    expect(prepared).toBe(false)
    await jest.advanceTimersByTimeAsync(1000)
    await preparation
    expect(prepared).toBe(true)
    expect(onSwitch).toHaveBeenLastCalledWith(inputs.usb)
    selector.stop()
    const suspended = makeInput('suspended', 0)
    createInputLevelMonitor.mockReturnValue({
        ready: new Promise(() => {}),
        sample: jest.fn(),
        getLevel: () => 0,
        getPeak: () => 0,
        close: jest.fn(),
    })
    listAudioInputDevices.mockResolvedValue([])
    selector = createVoiceMicrophoneSelector({ stream: suspended, onSwitch })
    const timeout = selector.whenPrepared()
    await jest.advanceTimersByTimeAsync(4500)
    await expect(timeout).resolves.toBe(false)
})
