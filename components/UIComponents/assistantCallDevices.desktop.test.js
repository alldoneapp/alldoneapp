import { createCallAudioDevices } from './assistantCallDevices'

let audio, mediaDevices, devices, controls
beforeEach(() => {
    devices = [
        { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
        { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
    ]
    mediaDevices = {
        enumerateDevices: jest.fn(async () => devices),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        selectAudioOutput: jest.fn(async () => ({ kind: 'audiooutput', deviceId: 'headset', label: 'Headset' })),
    }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
    audio = {
        sinkId: '',
        setSinkId: jest.fn(async id => {
            audio.sinkId = id
        }),
    }
})
afterEach(() => controls?.stop())

test('enumerates inputs and outputs without opening capture or prompting, and changes the actual playback sink', async () => {
    controls = createCallAudioDevices(audio)
    await controls.refresh()
    expect(controls.getSnapshot()).toMatchObject({
        supportsInputSelection: true,
        supportsOutputSelection: true,
        supportsOutputPrompt: true,
        inputDevices: [devices[0]],
        outputDevices: [devices[1]],
        outputDeviceId: '',
    })
    expect(mediaDevices.selectAudioOutput).not.toHaveBeenCalled()
    await controls.selectOutput('speakers')
    expect(audio.setSinkId).toHaveBeenLastCalledWith('speakers')
    expect(controls.getSnapshot().outputDeviceId).toBe('speakers')
    await controls.selectOutput('')
    expect(audio.sinkId).toBe('')
})

test('requests permission within the gesture for additional outputs and retains the granted device', async () => {
    controls = createCallAudioDevices(audio)
    await controls.refresh()
    const selection = controls.selectOutput('choose')
    expect(mediaDevices.selectAudioOutput).toHaveBeenCalledTimes(1)
    await selection
    expect(audio.setSinkId).toHaveBeenCalledWith('headset')
    expect(controls.getSnapshot().outputDevices).toContainEqual({
        kind: 'audiooutput',
        deviceId: 'headset',
        label: 'Headset',
    })
})

test('denied output selection preserves the working sink and can be retried', async () => {
    controls = createCallAudioDevices(audio)
    await controls.refresh()
    audio.setSinkId.mockRejectedValueOnce(new Error('Permission denied'))
    await expect(controls.selectOutput('speakers')).rejects.toThrow('Permission denied')
    expect(audio.sinkId).toBe('')
    await controls.selectOutput('speakers')
    expect(audio.sinkId).toBe('speakers')
})

test('devicechange refreshes options and restores system output after unplugging the selected output', async () => {
    controls = createCallAudioDevices(audio)
    await controls.refresh()
    await controls.selectOutput('speakers')
    devices = [devices[0]]
    await mediaDevices.addEventListener.mock.calls[0][1]()
    expect(audio.setSinkId).toHaveBeenLastCalledWith('')
    expect(controls.getSnapshot()).toMatchObject({
        outputDevices: [],
        notice: 'Audio output disconnected. Using system default.',
    })
    controls.stop()
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith(
        'devicechange',
        mediaDevices.addEventListener.mock.calls[0][1]
    )
})

test.each(['iPhone', 'Android'])(
    'uses exposed selection APIs on %s without opening unused microphones',
    async userAgent => {
        const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
        try {
            controls = createCallAudioDevices(audio)
            await controls.refresh()
            expect(controls.getSnapshot()).toMatchObject({
                supportsInputSelection: true,
                supportsOutputSelection: true,
            })
            await controls.selectOutput('speakers')
            expect(audio.setSinkId).toHaveBeenCalledWith('speakers')
        } finally {
            agent.mockRestore()
        }
    }
)

test('handles unsupported APIs and enumeration failure without breaking the call', async () => {
    controls = createCallAudioDevices({})
    mediaDevices.enumerateDevices.mockRejectedValue(new Error('Denied'))
    await controls.refresh()
    expect(controls.getSnapshot()).toMatchObject({
        supportsOutputSelection: false,
        notice: 'Audio device list unavailable',
    })
    controls.stop()
    delete mediaDevices.enumerateDevices
    controls = createCallAudioDevices({})
    expect(controls.getSnapshot().supportsInputSelection).toBe(false)
})

test('hangup while an output permission prompt is pending never routes a disposed call', async () => {
    let grant
    mediaDevices.selectAudioOutput.mockImplementation(
        () =>
            new Promise(resolve => {
                grant = resolve
            })
    )
    controls = createCallAudioDevices(audio)
    const selection = controls.selectOutput('choose')
    controls.stop()
    grant({ kind: 'audiooutput', deviceId: 'headset' })
    await selection
    expect(audio.setSinkId).not.toHaveBeenCalled()
})
