// A quiet outgoing-call tone: 1 second at 425 Hz, then 4 seconds of silence.
// Loop on the audio clock so throttled background timers cannot queue up rings.
// This is local playback only; it is never attached to the WebRTC sender.
export function startCallConnectingTone(windowObject = typeof window === 'undefined' ? null : window) {
    let context
    let source
    let stopped = false
    const stop = () => {
        if (stopped) return
        stopped = true
        try {
            source?.stop()
        } catch (_) {
            /* A partially initialized source may not have started. */
        }
        try {
            source?.disconnect()
        } catch (_) {
            /* Best-effort cleanup must not interrupt call teardown. */
        }
        try {
            Promise.resolve(context?.close()).catch(() => {})
        } catch (_) {
            /* Closing an interrupted context can fail on mobile. */
        }
    }
    const resume = () => {
        if (stopped || !context || context.state === 'running' || context.state === 'closed') return
        try {
            Promise.resolve(context.resume()).catch(() => {})
        } catch (_) {
            /* Autoplay denial affects only this optional feedback sound. */
        }
    }
    try {
        const AudioContext = windowObject?.AudioContext || windowObject?.webkitAudioContext
        if (!AudioContext) return null
        context = new AudioContext()
        const rate = context.sampleRate
        const buffer = context.createBuffer(1, rate * 5, rate)
        const samples = buffer.getChannelData(0)
        for (let i = 0; i < rate; i++) {
            // Short fades avoid clicks at the start/end of each ring.
            const fade = Math.min(1, i / (rate * 0.01), (rate - 1 - i) / (rate * 0.01))
            samples[i] = 0.04 * fade * Math.sin((2 * Math.PI * 425 * i) / rate)
        }
        source = context.createBufferSource()
        source.buffer = buffer
        source.loop = true
        source.connect(context.destination)
        source.start()
        // Called synchronously from the call-button gesture, before any await.
        resume()
        return { stop, resume }
    } catch (_) {
        stop()
        return null
    }
}
