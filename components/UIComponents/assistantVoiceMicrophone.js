import {
    createInputLevelMonitor,
    getInputDeviceId,
    getInputDeviceLabel,
    getInputGroupId,
    listAudioInputDevices,
} from '../../hooks/rambleMicCapture'
import { isMobileVoiceCallDevice } from './assistantCallAudio'

const stopStream = stream =>
    stream?.getTracks?.().forEach(track => {
        if (track.readyState !== 'ended') track.stop()
    })
const LAST_VOICE_MICROPHONE = 'alldone.voice.lastWorkingMicrophone'
const readLastMicrophone = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(LAST_VOICE_MICROPHONE))
        return typeof saved?.deviceId === 'string' ? saved : {}
    } catch (_) {
        return {}
    }
}
const constraints = (deviceId, raw = false) => ({
    audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: !raw,
        noiseSuppression: !raw,
        autoGainControl: false,
    },
})

// Reuse the last working desktop input immediately; live comparison still follows
// the user's voice. Phones must keep the system's headset/speaker routing.
export async function acquireVoiceMicrophone({ isCancelled = () => false } = {}) {
    const preference = isMobileVoiceCallDevice() ? {} : readLastMicrophone()
    const deviceId = preference.deviceId || ''
    let raw = preference.raw === true
    let stream
    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId, raw))
    } catch (error) {
        if (!deviceId || !['NotFoundError', 'OverconstrainedError'].includes(error?.name) || isCancelled()) throw error
        raw = false
        stream = await navigator.mediaDevices.getUserMedia(constraints())
    }
    if (isCancelled()) {
        stopStream(stream)
        throw new Error('voice_start_cancelled')
    }
    return { stream, deviceLabel: getInputDeviceLabel(stream), raw }
}

export function microphoneScore(levels) {
    const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b)
    return sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.8)] : 0
}

// On desktop, only the selected stream reaches WebRTC. Other inputs are metered
// locally for the call's lifetime so a newly used mic can win without a dialog.
export function createVoiceMicrophoneSelector({
    stream,
    raw = false,
    onSwitch,
    onBeforeRepair,
    onSample,
    isPaused = () => false,
}) {
    // Phones route input and output together. Opening a second, explicitly pinned
    // microphone can pull playback off Bluetooth (or onto the earpiece) before
    // replaceTrack even runs. Retain the system's default headset/speaker route;
    // the existing health monitor still recovers a dead default capture.
    const mobile = isMobileVoiceCallDevice()
    const captures = []
    let selected
    let stopped = false
    let busy = false
    let discovering = false
    let lastSwitch = -Infinity
    let silentWindows = 0
    let compatibilityTried = false
    let interval
    let warmupDone = false
    let resolveWarmup
    const warmup = new Promise(resolve => {
        resolveWarmup = resolve
    })
    let warmupTimer
    const finishWarmup = ready => {
        if (warmupDone) return
        warmupDone = true
        clearTimeout(warmupTimer)
        resolveWarmup(ready)
    }
    // Overlaps signaling; never require the caller to speak or wait indefinitely
    // for a browser that cannot meter audio.
    warmupTimer = setTimeout(() => finishWarmup(false), 4500)
    let remembered = JSON.stringify(readLastMicrophone())
    const add = (input, raw = false) => {
        const monitor = createInputLevelMonitor(input)
        const capture = { stream: input, monitor, levels: [], raw, ready: false }
        captures.push(capture)
        Promise.resolve(monitor?.ready).then(() => {
            if (!stopped) capture.ready = !!monitor
        })
        return capture
    }
    selected = add(stream, raw)
    if (!selected.monitor) finishWarmup(false)
    const usable = c => {
        const track = c.stream.getAudioTracks()[0]
        return track && track.readyState !== 'ended' && !track.muted
    }
    const open = async (deviceId, raw = false) => {
        let expired = false
        let timer
        try {
            return await Promise.race([
                navigator.mediaDevices.getUserMedia(constraints(deviceId, raw)).then(input => {
                    if (expired || stopped) {
                        stopStream(input)
                        return null
                    }
                    return input
                }),
                new Promise(resolve => {
                    timer = setTimeout(() => {
                        expired = true
                        resolve(null)
                    }, 2500)
                }),
            ])
        } catch (_) {
            return null
        } finally {
            clearTimeout(timer)
        }
    }
    const discover = async () => {
        if (mobile || stopped || discovering) return
        discovering = true
        try {
            const devices = await listAudioInputDevices()
            const ids = new Set(['', 'default', 'communications'])
            const groups = new Set()
            captures.filter(usable).forEach(c => {
                ids.add(getInputDeviceId(c.stream))
                const group = getInputGroupId(c.stream)
                if (group) groups.add(group)
            })
            const candidates = devices.filter(d => {
                if (ids.has(d.deviceId) || (d.groupId && groups.has(d.groupId))) return false
                ids.add(d.deviceId)
                if (d.groupId) groups.add(d.groupId)
                return true
            })
            await Promise.all(
                candidates.map(async d => {
                    if (stopped || isPaused()) return
                    const input = await open(d.deviceId)
                    if (input && !stopped) add(input)
                })
            )
        } finally {
            discovering = false
        }
    }
    const switchTo = async (candidate, repair = false) => {
        if (stopped || (!repair && isPaused())) return
        const changedDevice = candidate !== selected
        await onSwitch(candidate.stream)
        if (stopped) return
        selected = candidate
        if (changedDevice) lastSwitch = Date.now()
        captures.forEach(c => {
            c.levels = []
        })
    }
    const recoverSilence = async () => {
        compatibilityTried = true
        // Stop/reopen the broken processing path; applyConstraints alone does not
        // recover Chrome/macOS's bit-exact-zero capture failure.
        for (const capture of [...captures]) {
            if (stopped || isPaused()) return
            const id = getInputDeviceId(capture.stream)
            if (capture === selected) await onBeforeRepair?.(capture.stream)
            if (stopped || isPaused()) return
            capture.monitor?.close()
            stopStream(capture.stream)
            const raw = await open(id, true)
            if (!raw || stopped) continue
            capture.stream = raw
            capture.monitor = createInputLevelMonitor(raw)
            capture.ready = false
            await capture.monitor?.ready
            if (stopped) {
                capture.monitor?.close()
                stopStream(raw)
                return
            }
            capture.ready = !!capture.monitor
            capture.levels = []
            capture.raw = true
            if (capture === selected) await switchTo(capture, true)
        }
    }
    const getSnapshot = () => {
        const track = selected.stream.getAudioTracks()[0]
        const available = !stopped && selected.ready && selected.monitor?.isRunning?.() !== false
        return {
            label: getInputDeviceLabel(selected.stream),
            available: !!available,
            muted: !track || track.muted === true || track.enabled === false || track.readyState === 'ended',
            level: available && usable(selected) && track.enabled !== false ? selected.monitor.getLevel() : 0,
        }
    }
    const sample = async () => {
        if (stopped || busy) return
        // Keep the selected input meter live even while Anna speaks. Pausing the
        // comparison must not freeze its last value or display the output level.
        for (const c of captures) if (c.ready) c.monitor?.sample()
        onSample?.(getSnapshot())
        if (isPaused()) {
            captures.forEach(c => {
                c.levels = []
            })
            silentWindows = 0
            return
        }
        const snapshot = getSnapshot()
        const deviceId = getInputDeviceId(selected.stream)
        const preference = JSON.stringify({ deviceId, raw: selected.raw })
        if (
            !mobile &&
            snapshot.level >= 0.008 &&
            deviceId &&
            !['default', 'communications'].includes(deviceId) &&
            preference !== remembered
        ) {
            try {
                window.localStorage.setItem(LAST_VOICE_MICROPHONE, preference)
                remembered = preference
            } catch (_) {}
        }
        if (mobile) {
            if (snapshot.available && !snapshot.muted) finishWarmup(true)
            return
        }
        for (const c of captures) {
            if (!c.ready || c.monitor?.isRunning?.() === false) continue
            c.levels.push(c.monitor?.getLevel() || 0)
            if (c.levels.length > 12) c.levels.shift()
        }
        if (selected.levels.length < 12) return
        const candidates = captures.filter(c => usable(c) && c.levels.length >= 12)
        const best =
            candidates.reduce((a, b) => (!a || microphoneScore(b.levels) > microphoneScore(a.levels) ? b : a), null) ||
            selected
        const bestLevel = microphoneScore(best.levels)
        const currentLevel = microphoneScore(selected.levels)
        // A suspended/unavailable analyser is not evidence of a broken input.
        const allSilent = captures.every(c => c.ready && c.monitor?.isRunning?.() !== false && !c.monitor?.getPeak())
        silentWindows = allSilent ? silentWindows + 1 : 0
        busy = true
        try {
            if (
                best !== selected &&
                (!usable(selected) ||
                    (Date.now() - lastSwitch >= 4000 && bestLevel >= 0.008 && bestLevel > currentLevel * 1.6 + 0.003))
            ) {
                await switchTo(best)
            } else if (silentWindows >= (warmupDone ? 30 : 3) && !compatibilityTried) {
                await recoverSilence()
            }
            if (
                !discovering &&
                usable(selected) &&
                selected.ready &&
                selected.monitor?.isRunning?.() !== false &&
                selected.monitor?.getPeak() > 0
            )
                finishWarmup(true)
        } catch (_) {
            // A failed replaceTrack leaves the current sender in place; try again later.
            lastSwitch = Date.now()
        } finally {
            busy = false
        }
    }
    interval = setInterval(sample, 100)
    const mediaDevices = navigator.mediaDevices
    if (!mobile) mediaDevices.addEventListener?.('devicechange', discover)
    discover().catch(() => {})
    const discoveryInterval = mobile ? null : setInterval(() => discover().catch(() => {}), 5000)
    return {
        getSnapshot,
        whenPrepared: () => warmup,
        stop() {
            if (stopped) return
            stopped = true
            finishWarmup(false)
            clearInterval(interval)
            clearInterval(discoveryInterval)
            mediaDevices.removeEventListener?.('devicechange', discover)
            captures.forEach(c => {
                c.monitor?.close()
                stopStream(c.stream)
            })
        },
    }
}
