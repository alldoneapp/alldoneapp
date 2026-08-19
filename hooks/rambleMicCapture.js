/**
 * Microphone capture diagnostics for rambler dictation (AT-2357).
 *
 * The bug this exists for: on macOS, `getUserMedia({ audio: true })` enables Chrome's default
 * audio processing (echoCancellation / noiseSuppression / autoGainControl), which routes capture
 * through the system Voice-Processing I/O audio unit. With some input/output device combinations —
 * the reported one is a USB webcam mic while output stays on the MacBook speakers, but virtual
 * audio devices and mic modes do it too — that unit hands the page a track of literal DIGITAL
 * SILENCE, while macOS' own input-level meter (which never goes near the browser) keeps showing a
 * healthy level. It works with AirPods because input and output are then the same device.
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

/**
 * The user-facing setting (Settings → Customizations → "Dictation microphone"). It is per browser,
 * not per account, because it describes THIS machine's audio hardware: the same user on a phone
 * has no reason to inherit a laptop's workaround.
 *
 * `auto` learns and self-corrects. The two explicit modes exist because the workaround has a real
 * cost (no noise suppression, no auto gain) and the user must be able to say "stop doing that" —
 * an explicit choice is never overwritten by the learning path.
 */
export const MIC_MODE_AUTO = 'auto'
export const MIC_MODE_STANDARD = CAPTURE_MODE_PROCESSED
export const MIC_MODE_COMPATIBILITY = CAPTURE_MODE_RAW

export const micModeOptions = [
    { value: MIC_MODE_AUTO, label: 'Automatic' },
    { value: MIC_MODE_STANDARD, label: 'Standard (noise suppression on)' },
    { value: MIC_MODE_COMPATIBILITY, label: 'Compatibility (noise suppression off)' },
]

const MIC_MODE_STORAGE_KEY = 'rambler.micMode'
const LEARNED_CAPTURE_STORAGE_KEY = 'rambler.captureMode'

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

function readStorageItem(key) {
    try {
        return safeStorage()?.getItem(key) ?? null
    } catch (error) {
        return null
    }
}

function writeStorageItem(key, value) {
    try {
        const storage = safeStorage()
        if (!storage) return
        if (value === null) storage.removeItem(key)
        else storage.setItem(key, value)
    } catch (error) {
        // A remembered preference is an optimization; never fail a recording over it.
    }
}

export function readMicModeSetting() {
    const stored = readStorageItem(MIC_MODE_STORAGE_KEY)
    return stored === MIC_MODE_STANDARD || stored === MIC_MODE_COMPATIBILITY ? stored : MIC_MODE_AUTO
}

export function writeMicModeSetting(mode) {
    if (mode === MIC_MODE_STANDARD || mode === MIC_MODE_COMPATIBILITY) {
        writeStorageItem(MIC_MODE_STORAGE_KEY, mode)
    } else {
        writeStorageItem(MIC_MODE_STORAGE_KEY, null)
    }
    // Switching the setting by hand invalidates whatever the automatic path had concluded.
    forgetLearnedCaptureMode()
}

/**
 * What the automatic path has learned, tied to the device it was learned on. Returns `null` when
 * nothing is remembered. A plain legacy string is read as a device-less raw record so an older
 * remembered value degrades into "re-verify on the next device change" rather than being ignored.
 */
export function readLearnedCaptureMode() {
    const stored = readStorageItem(LEARNED_CAPTURE_STORAGE_KEY)
    if (!stored) return null
    if (stored === CAPTURE_MODE_RAW) return { mode: CAPTURE_MODE_RAW, deviceId: '', deviceLabel: '' }
    try {
        const parsed = JSON.parse(stored)
        return parsed?.mode === CAPTURE_MODE_RAW
            ? { mode: CAPTURE_MODE_RAW, deviceId: parsed.deviceId || '', deviceLabel: parsed.deviceLabel || '' }
            : null
    } catch (error) {
        return null
    }
}

export function rememberLearnedCaptureMode({ deviceId = '', deviceLabel = '' } = {}) {
    writeStorageItem(LEARNED_CAPTURE_STORAGE_KEY, JSON.stringify({ mode: CAPTURE_MODE_RAW, deviceId, deviceLabel }))
}

export function forgetLearnedCaptureMode() {
    writeStorageItem(LEARNED_CAPTURE_STORAGE_KEY, null)
}

/**
 * True while the automatic path is running with the workaround engaged — the Settings row uses it
 * to show that "Automatic" has actually switched something, which is otherwise invisible.
 */
export function isWorkaroundActive() {
    return readMicModeSetting() === MIC_MODE_AUTO && readLearnedCaptureMode() !== null
}

function firstAudioTrack(stream) {
    try {
        return stream?.getAudioTracks?.()[0] || null
    } catch (error) {
        return null
    }
}

export function getInputDeviceLabel(stream) {
    return firstAudioTrack(stream)?.label || ''
}

export function getInputDeviceId(stream) {
    const track = firstAudioTrack(stream)
    try {
        return track?.getSettings?.().deviceId || ''
    } catch (error) {
        return ''
    }
}

/**
 * A track Chrome has flagged `muted` is not "the user muted it" — it means the device stopped
 * delivering frames, which is the same failure seen from the track side.
 */
export function isTrackMuted(stream) {
    return firstAudioTrack(stream)?.muted === true
}

/**
 * Plugging in headphones, waking a dock or switching the system default changes which hardware the
 * "default" device actually is — and the deviceId does NOT move with it, so a learned workaround
 * would otherwise outlive the machine that needed it. Forgetting on `devicechange` costs at most
 * one probe (~350ms) on the next recording and is what makes the setting self-correcting in both
 * directions: it re-engages just as automatically as it stands down.
 */
// Refcounted, NOT a boolean latch: a RambleButton is mounted next to essentially every text input,
// so several hooks install this at once. A latch would let the first one to unmount remove the
// listener while the others are still mounted, and the invalidation would go quietly missing.
let deviceChangeSubscribers = 0
let removeDeviceChangeListener = null
export function installDeviceChangeInvalidation() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return () => {}

    if (deviceChangeSubscribers === 0) {
        const onDeviceChange = () => forgetLearnedCaptureMode()
        const mediaDevices = navigator.mediaDevices
        mediaDevices.addEventListener('devicechange', onDeviceChange)
        removeDeviceChangeListener = () => mediaDevices.removeEventListener?.('devicechange', onDeviceChange)
    }
    deviceChangeSubscribers += 1

    let released = false
    return () => {
        if (released) return
        released = true
        deviceChangeSubscribers -= 1
        if (deviceChangeSubscribers === 0) {
            removeDeviceChangeListener?.()
            removeDeviceChangeListener = null
        }
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

function releaseCapture(stream, monitor) {
    monitor?.close()
    try {
        stream?.getTracks?.().forEach(track => track.stop())
    } catch (error) {}
}

/**
 * Acquires the dictation stream, already verified to be delivering audio where that is knowable.
 *
 * Returns `{ stream, monitor, captureMode, setting, deviceId, deviceLabel }`. Rejects only with a
 * getUserMedia error, which the caller reports as a permission failure exactly as before.
 */
export async function acquireDictationStream({ requestStream, setting = readMicModeSetting() }) {
    const learned = setting === MIC_MODE_AUTO ? readLearnedCaptureMode() : null
    let captureMode = setting === MIC_MODE_AUTO ? learned?.mode || CAPTURE_MODE_PROCESSED : setting
    let stream = await requestStream(buildAudioConstraints(captureMode))
    let monitor = createInputLevelMonitor(stream)

    const result = () => ({
        stream,
        monitor,
        captureMode,
        setting,
        deviceId: getInputDeviceId(stream),
        deviceLabel: getInputDeviceLabel(stream),
    })

    // An explicit user choice is obeyed as written: no probe, no learning, no second acquisition.
    if (setting !== MIC_MODE_AUTO) return result()

    // A remembered workaround belongs to the device it was learned on. A different mic gets a fresh
    // verdict instead of silently inheriting a degraded mode.
    if (captureMode === CAPTURE_MODE_RAW && learned?.deviceId && getInputDeviceId(stream) !== learned.deviceId) {
        forgetLearnedCaptureMode()
        releaseCapture(stream, monitor)
        captureMode = CAPTURE_MODE_PROCESSED
        stream = await requestStream(buildAudioConstraints(captureMode))
        monitor = createInputLevelMonitor(stream)
    }

    if (captureMode !== CAPTURE_MODE_PROCESSED) return result()

    const alive = !isTrackMuted(stream) && (await waitForInputSignal(monitor))
    if (alive) return result()

    // The device handed us bit-exact silence. Re-acquire with the processing chain off BEFORE a
    // single byte is recorded, so the broken take never happens and no speech is lost.
    releaseCapture(stream, monitor)
    captureMode = CAPTURE_MODE_RAW
    stream = await requestStream(buildAudioConstraints(captureMode))
    monitor = createInputLevelMonitor(stream)
    // Silent processed AND alive raw is the proof that the processing path is the broken one —
    // only that combination earns a remembered preference.
    if (await waitForInputSignal(monitor)) {
        rememberLearnedCaptureMode({ deviceId: getInputDeviceId(stream), deviceLabel: getInputDeviceLabel(stream) })
    }
    return result()
}

/**
 * The end-of-recording verdict. `null` peak (no monitor) is deliberately NOT silent.
 */
export function isSilentCapture(peak) {
    if (peak === null || peak === undefined) return false
    return peak < SILENT_PEAK_THRESHOLD
}
