// Local, quiet ringback: 1 second at 425 Hz, then 4 seconds of silence.
// Use the SAME media element as the conversation: its gesture activation and
// speaker/headset route survive the handover, without a second AudioContext
// that can remain suspended (or be silenced separately on mobile Safari).
let toneUrl
function getToneUrl() {
    if (toneUrl) return toneUrl
    const rate = 16000
    const bytes = new Uint8Array(44 + rate * 5 * 2)
    const view = new DataView(bytes.buffer)
    const text = (offset, value) => [...value].forEach((char, i) => (bytes[offset + i] = char.charCodeAt(0)))
    text(0, 'RIFF')
    view.setUint32(4, bytes.length - 8, true)
    text(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, bytes.length - 44, true)
    for (let i = 0; i < rate; i++) {
        const fade = Math.min(1, i / (rate * 0.01), (rate - 1 - i) / (rate * 0.01))
        view.setInt16(44 + i * 2, Math.round(32767 * 0.08 * fade * Math.sin((2 * Math.PI * 425 * i) / rate)), true)
    }
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    toneUrl = `data:audio/wav;base64,${btoa(binary)}`
    return toneUrl
}

export function startCallConnectingTone(audio, onPlayback = () => {}) {
    if (!audio) return null
    let stopped = false
    const stop = () => {
        if (stopped) return
        stopped = true
        try {
            audio.pause()
            audio.loop = false
            audio.removeAttribute('src')
            audio.load()
        } catch (_) {
            /* Media teardown must not interrupt cancellation or wake-lock release. */
        }
    }
    const resume = () => {
        if (stopped) return
        try {
            // play() itself must run inside the gesture, not in a Promise.then.
            return Promise.resolve(audio.play()).then(
                () => {
                    if (!stopped) onPlayback(true)
                },
                () => {
                    if (!stopped) onPlayback(false)
                }
            )
        } catch (_) {
            if (!stopped) onPlayback(false)
        }
    }
    try {
        // Explicit play/retry keeps permission failures observable to the UI.
        audio.autoplay = false
        audio.setAttribute('playsinline', 'true')
        audio.muted = false
        audio.volume = 1 // Quietness is encoded in the waveform, not inherited by speech.
        audio.src = getToneUrl()
        audio.loop = true
        resume()
        return { stop, resume }
    } catch (_) {
        stop()
        return null
    }
}
