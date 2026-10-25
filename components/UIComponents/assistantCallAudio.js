// Prime the SAME audio element inside the initial call-button gesture. Later
// asynchronous permission/network work must not consume its playback activation.
export function primeCallAudio(audio) {
    audio.autoplay = true
    audio.setAttribute('playsinline', 'true')
    audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=='
    try {
        return Promise.resolve(audio.play()).then(
            () => true,
            () => false
        )
    } catch (_) {
        return Promise.resolve(false)
    }
}

export function isMobileVoiceCallDevice(navigatorObject = typeof navigator === 'undefined' ? null : navigator) {
    return !!(
        navigatorObject?.userAgentData?.mobile ||
        /Android|iPhone|iPad|iPod/i.test(navigatorObject?.userAgent || '') ||
        (navigatorObject?.platform === 'MacIntel' && navigatorObject?.maxTouchPoints > 1)
    )
}

// Set the call category before either playback or capture starts. On iOS WebKit
// play-and-record uses defaultToSpeaker with Bluetooth allowed. Keep the system
// route so connecting/disconnecting a headset can change both input and output.
// https://www.w3.org/TR/audio-session/#example-1
export function beginMobileCallAudioSession(navigatorObject = typeof navigator === 'undefined' ? null : navigator) {
    if (!isMobileVoiceCallDevice(navigatorObject)) return null
    let session
    let previousType
    try {
        session = navigatorObject?.audioSession
        if (!session) return null
        previousType = session.type
        session.type = 'play-and-record'
        if (session.type !== 'play-and-record') return null
    } catch (_) {
        // Browsers without this API retain their normal WebRTC audio routing.
        return null
    }
    let released = false
    return () => {
        if (released) return
        released = true
        try {
            // Do not overwrite another feature's explicit audio-session change.
            if (session.type === 'play-and-record') session.type = previousType
        } catch (_) {
            /* Releasing a browser audio preference must never prevent hangup. */
        }
    }
}
