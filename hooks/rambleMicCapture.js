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
 *
 * ---------------------------------------------------------------------------------------------
 * Follow-up (same ticket): the processing chain is only HALF the failure. The other half is WHICH
 * DEVICE the browser hands us, and it is not the one macOS shows in System Settings → Sound → Input.
 * A browser keeps its OWN microphone choice (Chrome: Settings → Site settings → Microphone, plus a
 * separate entry per installed PWA), and a device pinned there — or a stale cached "default" — wins
 * over the system input source. The reported failure named "MacBook Pro Microphone" in the error
 * while macOS was set to a webcam, with a healthy level meter on the webcam the whole time: we were
 * recording from a device the user had already moved away from, and switching the processing chain
 * on a dead device can only ever produce silence more efficiently.
 *
 * Two things follow, and they are the point of this module's device handling:
 *   1. Every re-acquisition PINS the device (`deviceId: { exact }`). Without it, the rescue call is
 *      a second unconstrained getUserMedia that is free to resolve to different hardware than the
 *      one we just measured — so the probe's verdict would be about one mic and the recording about
 *      another.
 *   2. When the acquired device is silent BOTH ways, we walk the other audio inputs and record from
 *      the first one that is actually alive, remembering it. That is the only lever a web page has:
 *      it cannot read or change the browser's device preference, but it can decline to record from
 *      a device that demonstrably produces nothing.
 * An explicit device chosen in Settings is never walked away from — same rule as the mode setting.
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
const PREFERRED_DEVICE_STORAGE_KEY = 'rambler.micDevice'
const LEARNED_DEVICE_STORAGE_KEY = 'rambler.inputDevice'

// "Let the browser decide", i.e. exactly the behaviour before this device handling existed.
export const SYSTEM_DEFAULT_DEVICE_ID = ''

// Chrome exposes two alias devices that merely point at a real one. They are never walk candidates:
// the alias IS what an unconstrained getUserMedia already gave us, so trying it retries the same
// hardware under a different id.
const ALIAS_DEVICE_IDS = new Set(['default', 'communications'])

// How many other inputs a silent device is allowed to cost us. Each dead candidate burns one probe
// timeout (~350ms) and a real one clears immediately, so the ceiling is about a second of extra
// wait in the worst case — paid only by a user whose microphone is already broken.
export const MAX_FALLBACK_DEVICES = 3

/**
 * `raw` disables the processing chain that produces the silent track. It is not a downgrade for
 * dictation: Deepgram's model handles unprocessed speech well, and browser noise suppression is
 * what breaks here, not what saves us.
 *
 * `deviceId` pins the hardware. It is `exact` on purpose: an `ideal` constraint is a preference the
 * browser may silently ignore, and a silently ignored pin is precisely the bug — we would believe we
 * re-acquired the mic we measured and in fact be recording from another one.
 */
export function buildAudioConstraints(mode, deviceId = SYSTEM_DEFAULT_DEVICE_ID) {
    const processingOff =
        mode === CAPTURE_MODE_RAW ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : null
    if (!deviceId) return processingOff || true
    return { deviceId: { exact: deviceId }, ...(processingOff || {}) }
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

function readDeviceRecord(key) {
    const stored = readStorageItem(key)
    if (!stored) return null
    try {
        const parsed = JSON.parse(stored)
        const deviceId = parsed?.deviceId || ''
        return deviceId ? { deviceId, label: parsed.label || '' } : null
    } catch (error) {
        return null
    }
}

function writeDeviceRecord(key, device) {
    if (!device?.deviceId) writeStorageItem(key, null)
    else writeStorageItem(key, JSON.stringify({ deviceId: device.deviceId, label: device.label || '' }))
}

/**
 * The microphone the user picked in Settings → Customizations → "Dictation microphone", or `null`
 * for "whatever the browser gives us". Per browser, like the mode: it names one machine's hardware.
 *
 * This exists because a web page cannot read, let alone change, the browser's own microphone
 * preference — so when that preference points at the wrong device, an in-app choice is the only
 * thing that can override it.
 */
export function readPreferredInputDevice() {
    return readDeviceRecord(PREFERRED_DEVICE_STORAGE_KEY)
}

export function writePreferredInputDevice(device) {
    writeDeviceRecord(PREFERRED_DEVICE_STORAGE_KEY, device)
    // Picking a device by hand invalidates everything the automatic path concluded about the old
    // one — both which mic works and which capture mode it needed.
    forgetLearnedCapture()
}

/**
 * The device the automatic walk proved alive, remembered so the next recording starts there instead
 * of paying the walk again. Retired exactly like the learned mode: on any device change, and when
 * it can no longer be acquired.
 */
export function readLearnedInputDevice() {
    return readDeviceRecord(LEARNED_DEVICE_STORAGE_KEY)
}

export function rememberLearnedInputDevice(device) {
    writeDeviceRecord(LEARNED_DEVICE_STORAGE_KEY, device)
}

export function forgetLearnedInputDevice() {
    writeStorageItem(LEARNED_DEVICE_STORAGE_KEY, null)
}

/** Everything the automatic path has learned about this machine's audio hardware. */
export function forgetLearnedCapture() {
    forgetLearnedCaptureMode()
    forgetLearnedInputDevice()
}

/**
 * The audio inputs the browser is willing to name. Labels are empty until microphone permission has
 * been granted once, which is why the Settings picker enumerates AFTER a permission prompt rather
 * than showing a list of anonymous "Microphone 2" entries.
 */
export async function listAudioInputDevices() {
    try {
        const devices = await navigator?.mediaDevices?.enumerateDevices?.()
        if (!Array.isArray(devices)) return []
        return devices
            .filter(device => device?.kind === 'audioinput')
            .map(device => ({
                deviceId: device.deviceId || '',
                label: device.label || '',
                groupId: device.groupId || '',
            }))
    } catch (error) {
        return []
    }
}

/**
 * "Default - MacBook Pro Microphone (Built-in)" and "MacBook Pro Microphone (Built-in)" are the same
 * hardware listed twice. Normalizing the alias prefix away keeps the walk from re-testing a device
 * we just measured, which would double the wait for no new information.
 */
function normalizeDeviceLabel(label) {
    return String(label || '')
        .replace(/^(default|communications)\s*-\s*/i, '')
        .trim()
        .toLowerCase()
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

/** Same physical device behind two ids (e.g. "default" and the concrete entry) shares a groupId. */
export function getInputGroupId(stream) {
    const track = firstAudioTrack(stream)
    try {
        return track?.getSettings?.().groupId || ''
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
        const onDeviceChange = () => forgetLearnedCapture()
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

function releaseCapture(capture) {
    capture?.monitor?.close()
    try {
        capture?.stream?.getTracks?.().forEach(track => track.stop())
    } catch (error) {}
}

/** An error raised because the requested device is gone, as opposed to a denied permission. */
function isUnavailableDeviceError(error) {
    const name = error?.name || ''
    return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'NotFoundError'
}

/**
 * One acquisition attempt. `deviceId` is a pin, but never a way to FAIL a recording: a remembered
 * device that has since been unplugged falls back to the browser's own choice instead of surfacing
 * as a permission error, and reports that it did so through `pinned: false`.
 */
async function openCapture(requestStream, mode, deviceId, { fallbackToDefault = true } = {}) {
    let stream
    let pinned = !!deviceId
    try {
        stream = await requestStream(buildAudioConstraints(mode, deviceId))
    } catch (error) {
        // A walk candidate that cannot be opened is skipped by its caller; retrying it unpinned
        // would just reopen the device we are trying to get away from.
        if (!deviceId || !fallbackToDefault || !isUnavailableDeviceError(error)) throw error
        pinned = false
        stream = await requestStream(buildAudioConstraints(mode))
    }
    return { stream, monitor: createInputLevelMonitor(stream), pinned }
}

function describeCapture(capture) {
    return {
        deviceId: getInputDeviceId(capture.stream),
        label: getInputDeviceLabel(capture.stream),
        groupId: getInputGroupId(capture.stream),
    }
}

/** Alive means: the track is delivering frames AND some energy reached the analyser. */
async function isCaptureAlive(capture) {
    if (isTrackMuted(capture.stream)) return false
    return waitForInputSignal(capture.monitor)
}

/**
 * Records from a DIFFERENT microphone when the one the browser picked is provably dead.
 *
 * Candidates are acquired raw: the processing chain is the known-broken half of this bug, and it is
 * the half we cannot inspect from here, so testing a fresh device with it enabled would just repeat
 * the failure we are escaping. Every failure mode of a candidate (device busy, permission scoped to
 * another device, enumeration unavailable) skips that candidate rather than aborting the walk.
 */
async function findWorkingInputDevice({ requestStream, enumerateDevices, tried }) {
    let devices = []
    try {
        devices = await enumerateDevices()
    } catch (error) {
        return null
    }

    const triedIds = new Set(tried.map(device => device.deviceId).filter(Boolean))
    const triedGroups = new Set(tried.map(device => device.groupId).filter(Boolean))
    const triedLabels = new Set(tried.map(device => normalizeDeviceLabel(device.label)).filter(Boolean))

    const candidates = devices
        .filter(device => device.deviceId && !ALIAS_DEVICE_IDS.has(device.deviceId))
        .filter(device => !triedIds.has(device.deviceId) && !triedGroups.has(device.groupId))
        .filter(device => !triedLabels.has(normalizeDeviceLabel(device.label)))
        .slice(0, MAX_FALLBACK_DEVICES)

    for (const candidate of candidates) {
        let capture
        try {
            capture = await openCapture(requestStream, CAPTURE_MODE_RAW, candidate.deviceId, {
                fallbackToDefault: false,
            })
        } catch (error) {
            tried.push({ deviceId: candidate.deviceId, label: candidate.label, groupId: candidate.groupId })
            continue
        }
        const description = describeCapture(capture)
        tried.push({
            deviceId: candidate.deviceId,
            label: candidate.label || description.label,
            groupId: candidate.groupId || description.groupId,
        })
        // A pin that could not be honoured means we are re-measuring the same device the browser
        // already chose; its verdict is not evidence about the candidate.
        if (capture.pinned && (await isCaptureAlive(capture))) {
            return { capture, device: { deviceId: candidate.deviceId, label: candidate.label || description.label } }
        }
        releaseCapture(capture)
    }
    return null
}

/**
 * Acquires the dictation stream, already verified to be delivering audio where that is knowable.
 *
 * Returns `{ stream, monitor, captureMode, setting, deviceId, deviceLabel, requestedDeviceId,
 * triedDevices, switchedDevice }`. Rejects only with a getUserMedia error the caller reports as a
 * permission failure exactly as before — a device that cannot be opened is never a hard failure.
 */
export async function acquireDictationStream({
    requestStream,
    setting = readMicModeSetting(),
    preferredDevice = readPreferredInputDevice(),
    enumerateDevices = listAudioInputDevices,
}) {
    const learned = setting === MIC_MODE_AUTO ? readLearnedCaptureMode() : null
    // An explicit device wins over a learned one; the learned device only fills the gap left by
    // "let the browser decide", which is where the wrong-microphone failure lives.
    const learnedDevice = preferredDevice ? null : readLearnedInputDevice()
    let deviceLocked = !!preferredDevice
    let requestedDeviceId = preferredDevice?.deviceId || learnedDevice?.deviceId || SYSTEM_DEFAULT_DEVICE_ID
    let captureMode = setting === MIC_MODE_AUTO ? learned?.mode || CAPTURE_MODE_PROCESSED : setting

    let capture = await openCapture(requestStream, captureMode, requestedDeviceId)
    if (requestedDeviceId && !capture.pinned) {
        // The remembered/chosen microphone is no longer there. Fall back to the browser's choice and
        // stop treating it as a lock, so the walk can still rescue this recording.
        if (!preferredDevice) forgetLearnedInputDevice()
        deviceLocked = false
        requestedDeviceId = SYSTEM_DEFAULT_DEVICE_ID
    }

    const tried = []
    let switchedDevice = false
    const result = () => ({
        stream: capture.stream,
        monitor: capture.monitor,
        captureMode,
        setting,
        deviceId: getInputDeviceId(capture.stream),
        deviceLabel: getInputDeviceLabel(capture.stream),
        requestedDeviceId,
        switchedDevice,
        triedDevices: tried.map(device => ({ deviceId: device.deviceId, label: device.label })),
    })

    // An explicit user choice is obeyed as written: no probe, no learning, no second acquisition.
    if (setting !== MIC_MODE_AUTO) return result()

    // A remembered workaround belongs to the device it was learned on. A different mic gets a fresh
    // verdict instead of silently inheriting a degraded mode.
    if (
        captureMode === CAPTURE_MODE_RAW &&
        learned?.deviceId &&
        getInputDeviceId(capture.stream) !== learned.deviceId
    ) {
        forgetLearnedCaptureMode()
        releaseCapture(capture)
        captureMode = CAPTURE_MODE_PROCESSED
        capture = await openCapture(requestStream, captureMode, requestedDeviceId)
    }

    if (captureMode !== CAPTURE_MODE_PROCESSED) return result()

    if (await isCaptureAlive(capture)) return result()

    // The device handed us bit-exact silence. Re-acquire with the processing chain off BEFORE a
    // single byte is recorded, so the broken take never happens and no speech is lost — PINNED to
    // the device we just measured, so the rescue cannot silently land on different hardware.
    const first = describeCapture(capture)
    tried.push(first)
    releaseCapture(capture)
    captureMode = CAPTURE_MODE_RAW
    capture = await openCapture(requestStream, captureMode, first.deviceId || requestedDeviceId)
    // Silent processed AND alive raw is the proof that the processing path is the broken one —
    // only that combination earns a remembered preference.
    if (await isCaptureAlive(capture)) {
        rememberLearnedCaptureMode({
            deviceId: getInputDeviceId(capture.stream),
            deviceLabel: getInputDeviceLabel(capture.stream),
        })
        return result()
    }

    // Silent both ways: this microphone is not producing audio at all, and no capture setting can
    // change that. The browser's microphone choice is not the system input source, so the device it
    // gave us may simply be the wrong one — try the others before charging the user for silence.
    if (deviceLocked) return result()

    const rescue = await findWorkingInputDevice({ requestStream, enumerateDevices, tried })
    if (!rescue) return result()

    releaseCapture(capture)
    capture = rescue.capture
    requestedDeviceId = rescue.device.deviceId
    switchedDevice = true
    rememberLearnedInputDevice(rescue.device)
    rememberLearnedCaptureMode({
        deviceId: getInputDeviceId(capture.stream) || rescue.device.deviceId,
        deviceLabel: getInputDeviceLabel(capture.stream) || rescue.device.label,
    })
    return result()
}

/**
 * The end-of-recording verdict. `null` peak (no monitor) is deliberately NOT silent.
 */
export function isSilentCapture(peak) {
    if (peak === null || peak === undefined) return false
    return peak < SILENT_PEAK_THRESHOLD
}
