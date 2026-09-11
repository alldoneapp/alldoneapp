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
})
test('stops a microphone whose permission resolves after cancellation', async () => {
    await expect(acquireVoiceMicrophone({ isCancelled: () => true })).rejects.toThrow('voice_start_cancelled')
    expect(inputs.builtin.getTracks()[0].stop).toHaveBeenCalledTimes(1)
})
