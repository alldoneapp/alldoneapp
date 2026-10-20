import { startCallConnectingTone } from './assistantCallConnectingTone'

function player() {
    return {
        play: jest.fn(async () => {}),
        pause: jest.fn(),
        load: jest.fn(),
        removeAttribute: jest.fn(),
        setAttribute: jest.fn(),
    }
}

test('plays an actual PCM WAV immediately on the call media element, with quiet faded 425 Hz ringback', () => {
    const audio = player()
    const tone = startCallConnectingTone(audio)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.loop).toBe(true)
    expect(audio.autoplay).toBe(false)
    expect(audio.muted).toBe(false)
    expect(audio.volume).toBe(1)
    const bytes = Buffer.from(audio.src.split(',')[1], 'base64')
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8)
    expect(bytes.readUInt32LE(24)).toBe(16000)
    expect(bytes.readUInt32LE(40)).toBe(16000 * 5 * 2)
    expect(bytes.readInt16LE(44)).toBe(0)
    expect(bytes.readInt16LE(44 + 15999 * 2)).toBe(0)
    expect(bytes.readInt16LE(44 + 1600 * 2 + 20 * 2) / 32767).toBeCloseTo(
        0.08 * Math.sin((2 * Math.PI * 425 * 1620) / 16000),
        4
    )
    expect(bytes.subarray(44 + 16000 * 2).every(byte => byte === 0)).toBe(true)
    tone.stop()
})

test('resumes interrupted media, stops once and cannot restart after stop', async () => {
    const audio = player(),
        onPlayback = jest.fn()
    const tone = startCallConnectingTone(audio, onPlayback)
    await tone.resume()
    expect(onPlayback).toHaveBeenCalledWith(true)
    tone.stop()
    tone.stop()
    tone.resume()
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.loop).toBe(false)
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    expect(audio.load).toHaveBeenCalledTimes(1)
})

test('reports autoplay rejection for a recovery gesture, ignoring stale completion after stop', async () => {
    const audio = player(),
        onPlayback = jest.fn()
    audio.play.mockRejectedValue(new Error('NotAllowedError'))
    const tone = startCallConnectingTone(audio, onPlayback)
    await Promise.resolve()
    expect(onPlayback).toHaveBeenCalledWith(false)
    onPlayback.mockClear()
    audio.play.mockResolvedValue(undefined)
    const pending = tone.resume()
    tone.stop()
    await pending
    expect(onPlayback).not.toHaveBeenCalled()
})

test('missing player and a synchronous playback failure do not interrupt call startup', () => {
    expect(startCallConnectingTone(null)).toBeNull()
    const audio = player(),
        onPlayback = jest.fn()
    audio.play.mockImplementation(() => {
        throw new Error('unavailable')
    })
    const tone = startCallConnectingTone(audio, onPlayback)
    expect(onPlayback).toHaveBeenCalledWith(false)
    tone.stop()
})
