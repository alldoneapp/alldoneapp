import { createMeetingChunker, MEETING_WORKLET } from './meetingAudio'

function processor(rate) {
    let Processor
    const Base = class {
        constructor() {
            this.port = { postMessage: jest.fn() }
        }
    }
    new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', MEETING_WORKLET)(
        Base,
        rate,
        (_, value) => {
            Processor = value
        }
    )
    return new Processor()
}

test.each([44100, 48000])('continuous worklet produces 16kHz PCM at %iHz without boundary resets', rate => {
    const capture = processor(rate)
    let frames = 0
    while (frames < rate * 2) {
        const count = Math.min(128, rate * 2 - frames)
        capture.process([[new Float32Array(count).fill(0.5)]])
        frames += count
    }
    capture.port.onmessage()
    const pcm = capture.port.postMessage.mock.calls.map(([value]) => value.pcm).filter(Boolean)
    expect(pcm.reduce((sum, value) => sum + value.length, 0)).toBe(32000)
    expect(pcm.every(value => value.every(sample => sample === 16384))).toBe(true)
    expect(capture.port.postMessage).toHaveBeenLastCalledWith({ stopped: true })
    expect(capture.process([])).toBe(false)
})

test('360 synthetic ten-second WAVs plus final partial block; repeated flush adds nothing', () => {
    const sizes = []
    const chunker = createMeetingChunker(blob => sizes.push(blob.size))
    const samples = new Int16Array(160000)
    for (let index = 0; index < 360; index++) chunker.push(samples)
    chunker.push(new Int16Array(1600))
    chunker.flush()
    chunker.flush()
    expect(sizes).toEqual([...Array(360).fill(320044), 3244])
})
