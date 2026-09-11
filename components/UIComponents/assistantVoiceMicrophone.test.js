import { acquireVoiceMicrophone, microphoneScore } from './assistantVoiceMicrophone'
import { createInputLevelMonitor, listAudioInputDevices } from '../../hooks/rambleMicCapture'

jest.mock('../../hooks/rambleMicCapture', () => ({
    createInputLevelMonitor: jest.fn(),
    listAudioInputDevices: jest.fn(),
    getInputDeviceId: stream => stream.id,
    getInputDeviceLabel: stream => stream.id,
    getInputGroupId: stream => `group-${stream.id}`,
}))
let inputs
let monitors
const makeInput = (id, level) => {
    const input = { id, level }
    const track = { readyState: 'live', muted: false, stop: jest.fn(), applyConstraints: jest.fn(async () => {}) }
    input.getAudioTracks = input.getTracks = () => [track]
    return input
}
beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    inputs = { default: makeInput('builtin', 0.02), usb: makeInput('usb', 0.3) }
    monitors = []
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: jest.fn(async ({ audio }) => inputs[audio?.deviceId?.exact || 'default']),
        },
    })
    listAudioInputDevices.mockResolvedValue([
        { deviceId: 'default' },
        { deviceId: 'builtin', groupId: 'group-builtin' },
        { deviceId: 'usb', groupId: 'group-usb' },
    ])
    createInputLevelMonitor.mockImplementation(stream => {
        let peak = 0
        let level = 0
        let samples = 0
        const monitor = {
            ready: Promise.resolve(),
            close: jest.fn(),
            sample: () => {
                level = typeof stream.level === 'function' ? stream.level(samples++) : stream.level
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
    jest.clearAllTimers()
    jest.useRealTimers()
})
const acquire = async options => {
    const pending = acquireVoiceMicrophone(options)
    await jest.advanceTimersByTimeAsync(5000)
    return pending
}

test('selects the strongest sustained input, excludes default aliases and stops unused capture', async () => {
    const result = await acquire()
    expect(result).toMatchObject({ stream: inputs.usb, deviceLabel: 'usb', hasSignal: true })
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(inputs.default.getAudioTracks()[0].stop).toHaveBeenCalledTimes(1)
    expect(inputs.usb.getAudioTracks()[0].stop).not.toHaveBeenCalled()
    expect(monitors.every(m => m.close.mock.calls.length === 1)).toBe(true)
})
test('a single click does not beat a microphone carrying sustained speech', async () => {
    inputs.default.level = index => (index === 0 ? 0.9 : 0.01)
    expect((await acquire()).stream).toBe(inputs.usb)
    expect(microphoneScore([0, 0, 0, 0, 1])).toBe(0)
})
test('skips inaccessible microphones while preserving the working default', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(async ({ audio }) => {
        if (audio?.deviceId) throw new Error('NotReadableError')
        return inputs.default
    })
    expect((await acquire()).stream).toBe(inputs.default)
    expect(inputs.default.getAudioTracks()[0].stop).not.toHaveBeenCalled()
})
test('tries processing compatibility only when every input supplies digital silence', async () => {
    listAudioInputDevices.mockResolvedValue([])
    inputs.default.level = 0
    navigator.mediaDevices.getUserMedia.mockImplementation(async ({ audio }) => {
        if (audio.echoCancellation === false) inputs.default.level = 0.1
        return inputs.default
    })
    expect(await acquire()).toMatchObject({ hasSignal: true, compatibilityMode: true })
})
test('cancellation stops every locally opened microphone', async () => {
    let cancelled = false
    const pending = acquireVoiceMicrophone({ isCancelled: () => cancelled }).catch(error => error)
    await jest.advanceTimersByTimeAsync(100)
    cancelled = true
    await jest.advanceTimersByTimeAsync(100)
    expect((await pending).message).toBe('voice_start_cancelled')
    expect(Object.values(inputs).every(input => input.getAudioTracks()[0].stop.mock.calls.length === 1)).toBe(true)
})
test('times out a stuck candidate and stops it if permission resolves later', async () => {
    let resolveUsb
    navigator.mediaDevices.getUserMedia.mockImplementation(({ audio }) =>
        audio?.deviceId
            ? new Promise(resolve => {
                  resolveUsb = resolve
              })
            : Promise.resolve(inputs.default)
    )
    expect((await acquire()).stream).toBe(inputs.default)
    resolveUsb(inputs.usb)
    await Promise.resolve()
    expect(inputs.usb.getAudioTracks()[0].stop).toHaveBeenCalledTimes(1)
})
