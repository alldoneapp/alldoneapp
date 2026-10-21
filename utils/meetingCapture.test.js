import { createMeetingCapture } from './meetingCapture'
import { acquireDictationStream } from '../hooks/rambleMicCapture'
import { keepScreenAwake } from './screenWakeLock'

jest.mock('../hooks/rambleMicCapture', () => ({
    acquireDictationStream: jest.fn(),
    rememberLastUsedInputDevice: jest.fn(),
}))
jest.mock('./screenWakeLock', () => ({ keepScreenAwake: jest.fn() }))

let node, context, track, monitor, release
const originalContext = window.AudioContext
const originalNode = window.AudioWorkletNode
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
beforeEach(() => {
    jest.clearAllMocks()
    track = { stop: jest.fn(), readyState: 'live' }
    monitor = { close: jest.fn() }
    release = jest.fn()
    keepScreenAwake.mockReturnValue(release)
    acquireDictationStream.mockResolvedValue({
        stream: { getTracks: () => [track], getAudioTracks: () => [track] },
        monitor,
        deviceLabel: 'Test mic',
    })
    URL.createObjectURL = jest.fn(() => 'blob:worklet')
    URL.revokeObjectURL = jest.fn()
    window.AudioContext = class {
        constructor() {
            context = this
            this.state = 'running'
            this.audioWorklet = { addModule: jest.fn(async () => {}) }
            this.resume = jest.fn(async () => {})
            this.close = jest.fn(async () => {
                this.state = 'closed'
            })
        }
        createMediaStreamSource() {
            return { connect() {}, disconnect() {} }
        }
    }
    window.AudioWorkletNode = class {
        constructor() {
            node = this
            this.port = {
                postMessage: () => {
                    this.port.onmessage({ data: { stopped: true } })
                },
            }
            this.disconnect = jest.fn()
        }
        connect() {}
    }
})
afterEach(() => {
    window.AudioContext = originalContext
    window.AudioWorkletNode = originalNode
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
})
const options = () => ({ onChunk: jest.fn(), onError: jest.fn(), onStopped: jest.fn() })
const frames = count => node.port.onmessage({ data: { pcm: new Int16Array(count) } })

test('partial final WAV is delivered before resources close; repeated stop is idempotent', async () => {
    const callbacks = options()
    callbacks.onChunk.mockImplementation(() => expect(track.stop).not.toHaveBeenCalled())
    const capture = createMeetingCapture(callbacks)
    await capture.start()
    frames(1600)
    await Promise.all([capture.stop(), capture.stop()])
    expect(callbacks.onChunk).toHaveBeenCalledTimes(1)
    expect(callbacks.onChunk.mock.calls[0][0].size).toBe(3244)
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1)
})

test('capture continues beyond five minutes and one hour until explicit stop, retaining the final short block', async () => {
    const callbacks = options()
    const capture = createMeetingCapture(callbacks)
    await capture.start()
    const pcm = new Int16Array(160000)
    for (let i = 0; i < 361; i++) node.port.onmessage({ data: { pcm } })
    frames(1600)
    expect(callbacks.onChunk).toHaveBeenCalledTimes(361)
    expect(callbacks.onStopped).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    await capture.stop()
    expect(callbacks.onChunk).toHaveBeenCalledTimes(362)
    expect(callbacks.onChunk.mock.calls[361][0].size).toBe(3244)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
})

test('late microphone permission after stop releases the acquired stream without starting worklet', async () => {
    const stream = { getTracks: () => [track] }
    let permit
    acquireDictationStream.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                permit = resolve
            })
    )
    const callbacks = options()
    const capture = createMeetingCapture(callbacks)
    const starting = capture.start()
    await Promise.resolve()
    await capture.stop()
    permit({ stream, monitor })
    expect(await starting).toBe(false)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(monitor.close).toHaveBeenCalledTimes(1)
    expect(context.audioWorklet.addModule).not.toHaveBeenCalled()
})

test('track loss stops capture visibly and retains the final partial block', async () => {
    const callbacks = options()
    const capture = createMeetingCapture(callbacks)
    await capture.start()
    frames(800)
    track.onended()
    await capture.stop()
    expect(callbacks.onError).toHaveBeenCalledWith('capture-interrupted')
    expect(callbacks.onChunk.mock.calls[0][0].size).toBe(1644)
    expect(track.stop).toHaveBeenCalledTimes(1)
})
