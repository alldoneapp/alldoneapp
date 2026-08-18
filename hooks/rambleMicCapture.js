/**
 * Microphone capture diagnostics for rambler dictation (AT-2357).
 *
 * The bug this exists for: on macOS, `getUserMedia({ audio: true })` enables Chrome's default
 * audio processing (echoCancellation / noiseSuppression / autoGainControl), which routes capture
 * through the system Voice-Processing I/O audio unit. With some input/output device combinations
 * (built-in mic + a different output device, virtual audio devices, mic modes) that unit hands the
 * page a track of literal DIGITAL SILENCE — while macOS' own input-level meter, which never goes
 * near the browser, keeps showing a healthy level. It works with AirPods because input and output
 * are then the same device and the processing path initializes correctly.
 *
 * The failure is invisible everywhere it should be visible: MediaRecorder happily encodes the
 * silence, the blob is non-empty (Opus compresses silence to a few hundred bytes/s), so the client
 * size guard passes, the clip uploads, Gold is spent, and the user gets "No speech detected" from
 * a server that did exactly the right thing with the bytes it was given. Production payload sizes
 * for the reported failures were 3.7-5.9 KB against ~102 KB for the working takes in the same
 * session — the same speech, ~25x less data.
 *
 * So we measure the captured signal in the browser:
 *   - before recording, a short probe rescues the take by re-acquiring the mic with processing
 *     disabled when the device delivers ZERO energy (`hasSignal` is `peak > 0`, so anything a real
 *     microphone produces — even self-noise well below hearing — counts as alive);
 *   - during recording, the running peak decides whether we captured anything at all, so a silent
 *     take is reported locally instead of being uploaded and billed.
 *
 * Everything degrades to "unknown" when Web Audio is unavailable (jsdom, old browsers): unknown
 * NEVER blocks an upload, it only means we fall back to the previous behaviour.
 */

// Recording-level verdict: below this peak amplitude nothing intelligible was captured. Kept at
// ~-66 dBFS — three orders of magnitude under normal speech peaks and under any real room floor —
// because a false "silent" verdict would throw away a recording the user actually made.
export const SILENT_PEAK_THRESHOLD = 0.0005

// How long the pre-flight probe waits for the first sign of life before declaring the device dead.
// A healthy mic clears it on the first read, so this delay is only ever paid by a broken one.
export const INPUT_SIGNAL_PROBE_TIMEOUT_MS = 350
export const INPUT_SIGNAL_POLL_MS = 50

export const CAPTURE_MODE_PROCESSED = 'processed'
export const CAPTURE_MODE_RAW = 'raw'

const CAPTURE_MODE_STORAGE_KEY = 'rambler.captureMode'

/**
 * `raw` disables the processing chain that produces the silent track. It is not a downgrade for
 * dictation: Deepgram's model handles unprocessed speech well, and browser noise suppression is
 * what breaks here, not what saves us.
 */
export function buildAudioConstraints(mode) {
    if (mode === CAPTURE_MODE_RAW) {
        return { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }
    return true
}

function safeStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch (error) {
        // Safari in private mode throws on access rather than returning null.
        return null
    }
}

export function readPreferredCaptureMode() {
    try {
        return safeStorage()?.getItem(CAPTURE_MODE_STORAGE_KEY) === CAPTURE_MODE_RAW
            ? CAPTURE_MODE_RAW
            : CAPTURE_MODE_PROCESSED
    } catch (error) {
        return CAPTURE_MODE_PROCESSED
    }
}

export function writePreferredCaptureMode(mode) {
    try {
        const storage = safeStorage()
        if (!storage) return
        if (mode === CAPTURE_MODE_RAW) storage.setItem(CAPTURE_MODE_STORAGE_KEY, CAPTURE_MODE_RAW)
        else storage.removeItem(CAPTURE_MODE_STORAGE_KEY)
    } catch (error) {
        // A remembered preference is an optimization; never fail a recording over it.
    }
}

export function getInputDeviceLabel(stream) {
    try {
        const track = stream?.getAudioTracks?.()[0]
        return track?.label || ''
    } catch (error) {
        return ''
    }
}

/**
 * A track Chrome has flagged `muted` is not "the user muted it" — it means the device stopped
 * delivering frames, which is the same failure seen from the track side.
 */
export function isTrackMuted(stream) {
    try {
        const track = stream?.getAudioTracks?.()[0]
        return !!track && track.muted === true
    } catch (error) {
        return false
    }
}

function getAudioContextConstructor() {
    if (typeof window === 'undefined') return null
    return window.AudioContext || window.webkitAudioContext || null
}

/**
 * Peak-amplitude monitor over the live capture stream.
 *
 * Returns `null` when Web Audio is unavailable, which callers must read as "cannot tell" and treat
 * as healthy — the point of this module is to catch a specific broken device, never to add a new
 * way for dictation to refuse to work.
 */
export function createInputLevelMonitor(stream) {
    const AudioContextConstructor = getAudioContextConstructor()
    if (!AudioContextConstructor || typeof stream?.getAudioTracks !== 'function') return null

    let audioContext
    let source
    let analyser
    let buffer
    let ready = Promise.resolve()
    try {
        audioContext = new AudioContextConstructor()
        source = audioContext.createMediaStreamSource(stream)
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        buffer = new Float32Array(analyser.fftSize)
        // The context can start suspended even inside a gesture, and a suspended context reads
        // zeros — indistinguishable from the dead device we are looking for. Callers await `ready`
        // before probing so a slow resume cannot be mistaken for silence.
        ready = Promise.resolve(audioContext.resume?.()).catch(() => {})
    } catch (error) {
        try {
            audioContext?.close?.()
        } catch (closeError) {}
        return null
    }

    let peak = 0
    let closed = false

    const sample = () => {
        if (closed) return peak
        try {
            analyser.getFloatTimeDomainData(buffer)
            for (let index = 0; index < buffer.length; index += 1) {
                const amplitude = Math.abs(buffer[index])
                if (amplitude > peak) peak = amplitude
            }
        } catch (error) {
            // A closed/interrupted context stops contributing; the peak so far still stands.
        }
        return peak
    }

    return {
        ready,
        sample,
        getPeak: () => peak,
        hasSignal: () => peak > 0,
        close: () => {
            if (closed) return
            closed = true
            try {
                source.disconnect()
            } catch (error) {}
            try {
                audioContext.close?.()
            } catch (error) {}
        },
    }
}

/**
 * Resolves as soon as ANY energy reaches the analyser, or after `timeoutMs` with `false`.
 * `false` means the device produced bit-exact silence for the whole window — a live microphone,
 * however quiet the room, does not do that.
 */
export async function waitForInputSignal(
    monitor,
    { timeoutMs = INPUT_SIGNAL_PROBE_TIMEOUT_MS, pollMs = INPUT_SIGNAL_POLL_MS } = {}
) {
    if (!monitor) return true
    await monitor.ready
    return new Promise(resolve => {
        const startedAt = Date.now()
        const poll = () => {
            if (monitor.sample() > 0) return resolve(true)
            if (Date.now() - startedAt >= timeoutMs) return resolve(false)
            setTimeout(poll, pollMs)
        }
        poll()
    })
}

/**
 * The end-of-recording verdict. `null` peak (no monitor) is deliberately NOT silent.
 */
export function isSilentCapture(peak) {
    if (peak === null || peak === undefined) return false
    return peak < SILENT_PEAK_THRESHOLD
}
