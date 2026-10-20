import { startCallConnectingTone } from './assistantCallConnectingTone'

function audioEnvironment(state = 'suspended') {
    const samples = new Float32Array(48000 * 5)
    const source = { connect: jest.fn(), start: jest.fn(), stop: jest.fn(), disconnect: jest.fn() }
    const context = {
        state,
        sampleRate: 48000,
        destination: {},
        createBuffer: jest.fn(() => ({ getChannelData: () => samples })),
        createBufferSource: jest.fn(() => source),
        resume: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
    }
    const AudioContext = jest.fn(() => context)
    return { windowObject: { AudioContext }, context, source, samples }
}

test('starts quiet repeated ringback immediately, with fades and four seconds of silence', () => {
    const { windowObject, context, source, samples } = audioEnvironment()
    const tone = startCallConnectingTone(windowObject)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(source.start).toHaveBeenCalledTimes(1)
    expect(source.loop).toBe(true)
    expect(source.connect).toHaveBeenCalledWith(context.destination)
    expect(samples[0]).toBe(0)
    expect(samples[47999]).toBeCloseTo(0)
    expect(samples.slice(48000).every(sample => sample === 0)).toBe(true)
    const amplitude = samples.slice(480, 47520).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    expect(amplitude).toBeCloseTo(0.04)
    // One sample at a quarter wavelength: verifies the intended tone frequency.
    expect(samples[4800 + 28]).toBeCloseTo(0.04 * Math.sin((2 * Math.PI * 425 * (4800 + 28)) / 48000))
    tone.stop()
})

test('resumes after an interruption and stops/disconnects/closes once without restarting after stop', () => {
    const { windowObject, context, source } = audioEnvironment('running')
    const tone = startCallConnectingTone(windowObject)
    expect(context.resume).not.toHaveBeenCalled()
    context.state = 'interrupted'
    tone.resume()
    expect(context.resume).toHaveBeenCalledTimes(1)
    tone.stop()
    tone.stop()
    tone.resume()
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(source.stop).toHaveBeenCalledTimes(1)
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
})

test('supports the WebKit constructor and degrades silently when Web Audio is absent', () => {
    const { windowObject } = audioEnvironment()
    const tone = startCallConnectingTone({ webkitAudioContext: windowObject.AudioContext })
    expect(tone).toBeTruthy()
    tone.stop()
    expect(startCallConnectingTone({})).toBeNull()
    expect(startCallConnectingTone(null)).toBeNull()
})

test('autoplay rejection and asynchronous close rejection never escape into call startup/cleanup', async () => {
    const { windowObject, context } = audioEnvironment()
    context.resume.mockRejectedValue(new Error('NotAllowedError'))
    context.close.mockRejectedValue(new Error('Already closed'))
    const tone = startCallConnectingTone(windowObject)
    expect(() => tone.stop()).not.toThrow()
    await Promise.resolve()
})

test('cleans up a partially initialized context if creating or starting playback fails', () => {
    const { windowObject, context, source } = audioEnvironment()
    source.start.mockImplementation(() => {
        throw new Error('unavailable')
    })
    source.stop.mockImplementation(() => {
        throw new Error('not started')
    })
    expect(startCallConnectingTone(windowObject)).toBeNull()
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
})
