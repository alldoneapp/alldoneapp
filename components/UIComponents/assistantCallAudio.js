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
