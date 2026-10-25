import { createCallDeviceController } from './assistantCallDevices'
import { subscribePageVisible } from '../../utils/appResume'

jest.mock('../../utils/appResume', () => ({ subscribePageVisible: jest.fn(() => jest.fn()) }))
const input = (deviceId, label = deviceId) => ({ kind: 'audioinput', deviceId, label, groupId: deviceId })
const output = (deviceId, label = deviceId) => ({ kind: 'audiooutput', deviceId, label, groupId: deviceId })
let controller, inventory, selected, audio, mediaDevices, onChange, selectInput, hidden
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}
const latest = () => onChange.mock.calls.at(-1)[0]
const start = async (options = {}) => {
    controller = createCallDeviceController({
        audio,
        mediaDevices,
        getInput: () => selected,
        selectInput,
        onChange,
        isHidden: () => hidden,
        ...options,
    })
    await flush()
}
beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    inventory = [input('builtin', 'Built-in microphone'), output('speaker', 'Speakers')]
    selected = { deviceId: 'builtin', label: 'Built-in microphone' }
    hidden = false
    audio = { sinkId: '', setSinkId: jest.fn(async id => (audio.sinkId = id)) }
    mediaDevices = {
        enumerateDevices: jest.fn(async () => inventory),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        selectAudioOutput: jest.fn(async () => output('approved', 'Headphones')),
    }
    selectInput = jest.fn(async id => {
        selected = { deviceId: id || 'builtin', label: id || 'Built-in microphone' }
    })
    onChange = jest.fn()
})
afterEach(() => {
    controller?.stop()
    jest.clearAllTimers()
    jest.useRealTimers()
})

test('lists permitted devices without opening microphones and switches output in place', async () => {
    await start()
    expect(latest()).toMatchObject({ inputId: 'builtin', canSelectOutput: true, canRequestOutput: true })
    expect(selectInput).not.toHaveBeenCalled()
    await controller.selectOutput('speaker')
    expect(audio.setSinkId).toHaveBeenCalledWith('speaker')
    expect(latest().outputId).toBe('speaker')
    expect(selectInput).not.toHaveBeenCalled()
})

test('detects new AirPods by devicechange and switches both directions once without measuring unused mics', async () => {
    await start()
    inventory.push(input('pods-mic', 'AirPods Pro'), output('pods-out', 'AirPods Pro'))
    await mediaDevices.addEventListener.mock.calls[0][1]()
    await flush()
    expect(selectInput).toHaveBeenCalledTimes(1)
    expect(selectInput).toHaveBeenCalledWith('pods-mic')
    expect(audio.setSinkId).toHaveBeenCalledWith('pods-out')
    expect(latest()).toMatchObject({ inputId: 'pods-mic', outputId: 'pods-out', error: '' })
    await jest.advanceTimersByTimeAsync(6000)
    expect(selectInput).toHaveBeenCalledTimes(1)
})

test('polling finds a headset when a mobile browser omits devicechange and honors later manual selection', async () => {
    audio = {}
    await start()
    inventory.push(input('pods', 'AirPods'))
    await jest.advanceTimersByTimeAsync(2000)
    expect(selectInput).toHaveBeenCalledTimes(1)
    expect(selectInput).toHaveBeenCalledWith('pods')
    await controller.selectInput('builtin')
    await jest.advanceTimersByTimeAsync(6000)
    expect(latest().inputId).toBe('builtin')
    expect(selectInput).toHaveBeenCalledTimes(2)
})

test('falls back to system devices on unplug and retains inventory during a failed read', async () => {
    await start()
    inventory.push(input('pods', 'AirPods'), output('pods-out', 'AirPods'))
    await controller.refresh()
    await flush()
    mediaDevices.enumerateDevices.mockRejectedValueOnce(new Error('Temporary failure'))
    await controller.refresh()
    expect(latest().inputId).toBe('pods')
    inventory = [input('builtin'), output('speaker')]
    await controller.refresh()
    await flush()
    expect(selectInput).toHaveBeenLastCalledWith('')
    expect(audio.setSinkId).toHaveBeenLastCalledWith('')
    expect(latest()).toMatchObject({ inputId: 'builtin', outputId: '' })
})

test('does not interpret newly exposed built-in devices as headsets', async () => {
    await start()
    inventory.push(input('camera-mic', 'Webcam microphone'), input('earpiece', 'Headset earpiece'))
    await controller.refresh()
    expect(selectInput).not.toHaveBeenCalled()
})

test('uses Android communication inputs for output switching without setSinkId', async () => {
    audio = {}
    inventory.push(input('speakerphone', 'Speakerphone'), input('earpiece', 'Headset earpiece'))
    await start()
    expect(latest().canSelectOutput).toBe(true)
    await controller.selectOutput('earpiece')
    await flush()
    expect(selectInput).toHaveBeenCalledWith('earpiece')
    expect(latest()).toMatchObject({ inputId: 'earpiece', outputId: 'earpiece' })
})

test('reports unavailable browser routing honestly and preserves the active output on failure', async () => {
    audio = {}
    await start()
    expect(latest()).toMatchObject({ outputs: [], canSelectOutput: false })
    await controller.selectOutput('made-up-speaker')
    expect(selectInput).not.toHaveBeenCalled()
    expect(latest().error).toBe('Could not switch call audio device')
    controller.stop()
    audio = { sinkId: 'speaker', setSinkId: jest.fn().mockRejectedValue(new Error('Denied')) }
    await start()
    await controller.selectOutput('pods-out')
    await flush()
    expect(latest()).toMatchObject({ outputId: 'speaker', error: 'Could not switch call audio device' })
})

test('invokes the permission picker within the gesture and ignores a picker completed after hangup', async () => {
    let complete
    mediaDevices.selectAudioOutput.mockImplementation(() => new Promise(resolve => (complete = resolve)))
    await start()
    const pending = controller.requestOutput()
    expect(mediaDevices.selectAudioOutput).toHaveBeenCalledTimes(1)
    controller.stop()
    complete(output('late'))
    await pending
    expect(audio.setSinkId).not.toHaveBeenCalled()
})

test('defers hotplug until foreground and releases polling and listeners on hangup', async () => {
    await start()
    hidden = true
    inventory.push(input('pods', 'AirPods'))
    await jest.advanceTimersByTimeAsync(6000)
    expect(selectInput).not.toHaveBeenCalled()
    hidden = false
    await subscribePageVisible.mock.calls[0][0]()
    await flush()
    expect(selectInput).toHaveBeenCalledWith('pods')
    controller.stop()
    const reads = mediaDevices.enumerateDevices.mock.calls.length
    await jest.advanceTimersByTimeAsync(6000)
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(reads)
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function))
    expect(subscribePageVisible.mock.results[0].value).toHaveBeenCalled()
})

test('uses the native iOS route inventory and reports the actual coupled route after selection', async () => {
    const native = {
        inputs: [input('iphone', 'iPhone microphone'), input('pods', 'AirPods')],
        outputs: [
            { deviceId: 'speaker', labelKey: 'Speakerphone' },
            { deviceId: 'input:pods', label: 'AirPods' },
        ],
        inputId: 'iphone',
        outputId: 'speaker',
    }
    const listener = { remove: jest.fn() }
    const nativePlugin = {
        getAudioDevices: jest.fn(async () => native),
        setInput: jest.fn(async () => Object.assign(native, { inputId: 'pods', outputId: 'input:pods' })),
        setOutput: jest.fn(async () => ({ ...native, inputId: 'iphone', outputId: 'speaker' })),
        addListener: jest.fn(async () => listener),
    }
    await start({ nativePlugin })
    await controller.selectInput('pods')
    await flush()
    expect(nativePlugin.setInput).toHaveBeenCalledWith({ deviceId: 'pods' })
    expect(selectInput).not.toHaveBeenCalled()
    expect(audio.setSinkId).not.toHaveBeenCalled()
    expect(latest()).toMatchObject({ native: true, canSelectOutput: true, inputId: 'pods', outputId: 'input:pods' })
    native.inputId = 'iphone'
    native.outputId = 'speaker'
    await nativePlugin.addListener.mock.calls[0][1]()
    expect(latest()).toMatchObject({ inputId: 'iphone', outputId: 'speaker' })
    controller.stop()
    expect(listener.remove).toHaveBeenCalled()
})

test('removes a native listener whose registration finishes after hangup', async () => {
    let register
    const remove = jest.fn()
    await start({
        nativePlugin: { getAudioDevices: async () => ({}), addListener: () => new Promise(r => (register = r)) },
    })
    controller.stop()
    register({ remove })
    await flush()
    expect(remove).toHaveBeenCalledTimes(1)
})
