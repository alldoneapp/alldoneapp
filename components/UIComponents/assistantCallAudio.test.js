import { beginMobileCallAudioSession, isMobileVoiceCallDevice } from './assistantCallAudio'

test.each([
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' },
    { userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9)' },
    { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgentData: { mobile: true } },
])('recognizes a mobile call device: %j', device => {
    expect(isMobileVoiceCallDevice(device)).toBe(true)
})

test('configures recording/playback together and restores the previous session after hangup', () => {
    const audioSession = { type: 'auto' }
    const release = beginMobileCallAudioSession({ userAgent: 'iPhone', audioSession })
    expect(audioSession.type).toBe('play-and-record')
    release()
    expect(audioSession.type).toBe('auto')
    audioSession.type = 'playback'
    release()
    expect(audioSession.type).toBe('playback')
})

test('does not overwrite an audio preference changed by another feature during the call', () => {
    const audioSession = { type: 'auto' }
    const release = beginMobileCallAudioSession({ userAgent: 'iPhone', audioSession })
    audioSession.type = 'ambient'
    release()
    expect(audioSession.type).toBe('ambient')
})

test('leaves desktop and browsers without AudioSession on their existing routing', () => {
    const audioSession = { type: 'playback' }
    expect(beginMobileCallAudioSession({ userAgent: 'Macintosh', audioSession })).toBeNull()
    expect(audioSession.type).toBe('playback')
    expect(beginMobileCallAudioSession({ userAgent: 'Android' })).toBeNull()
    expect(beginMobileCallAudioSession(null)).toBeNull()
})

test('an unavailable audio-session setting never prevents starting a call', () => {
    const audioSession = Object.freeze({ type: 'auto' })
    expect(beginMobileCallAudioSession({ userAgent: 'iPhone', audioSession })).toBeNull()
})
