import {
    createInputLevelMonitor,
    getInputDeviceId,
    getInputDeviceLabel,
    getInputGroupId,
    listAudioInputDevices,
} from '../../hooks/rambleMicCapture'
import { isMobileVoiceCallDevice } from './assistantCallAudio'

const stopStream = stream => stream?.getTracks?.().forEach(track => track.stop())
const constraints = (deviceId, raw = false) => ({
    audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: !raw,
        noiseSuppression: !raw,
        autoGainControl: false,
    },
})

// Start immediately with the default input. Comparison happens during the call.
export async function acquireVoiceMicrophone({ isCancelled = () => false } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints())
    if (isCancelled()) {
        stopStream(stream)
        throw new Error('voice_start_cancelled')
    }
    return { stream, deviceLabel: getInputDeviceLabel(stream) }
}

export function microphoneScore(levels) {
    const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b)
    return sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.8)] : 0
}

// On desktop, only the selected stream reaches WebRTC. Other inputs are metered
// locally for the call's lifetime so a newly used mic can win without a dialog.
export function createVoiceMicrophoneSelector({ stream, onSwitch, isPaused = () => false }) {
    // Phones route input and output together. Opening a second, explicitly pinned
    // microphone can pull playback off Bluetooth (or onto the earpiece) before
    // replaceTrack even runs. Retain the system's default headset/speaker route;
    // the existing health monitor still recovers a dead default capture.
    if (isMobileVoiceCallDevice()) return null
    const captures = []
    let selected
    let stopped = false
    let busy = false
    let discovering = false
    let lastSwitch = -Infinity
    let silentWindows = 0
    let compatibilityTried = false
    let interval
    const add = (input, raw = false) => {
        const capture = { stream: input, monitor: createInputLevelMonitor(input), levels: [], raw }
        captures.push(capture)
        return capture
    }
    selected = add(stream)
    if (!selected.monitor) return null
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
        if (stopped || discovering) return
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
            capture.monitor?.close()
            stopStream(capture.stream)
            const raw = await open(id, true)
            if (!raw || stopped) continue
            capture.stream = raw
            capture.monitor = createInputLevelMonitor(raw)
            capture.levels = []
            capture.raw = true
            if (capture === selected) await switchTo(capture, true)
        }
    }
    const sample = async () => {
        if (stopped || busy) return
        if (isPaused()) {
            captures.forEach(c => {
                c.levels = []
            })
            silentWindows = 0
            return
        }
        for (const c of captures) {
            c.monitor?.sample()
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
        const allSilent = captures.every(c => !c.monitor?.getPeak())
        silentWindows = allSilent ? silentWindows + 1 : 0
        busy = true
        try {
            if (
                best !== selected &&
                (!usable(selected) ||
                    (Date.now() - lastSwitch >= 4000 && bestLevel >= 0.008 && bestLevel > currentLevel * 1.6 + 0.003))
            ) {
                await switchTo(best)
            } else if (silentWindows >= 30 && !compatibilityTried) {
                await recoverSilence()
            }
        } catch (_) {
            // A failed replaceTrack leaves the current sender in place; try again later.
            lastSwitch = Date.now()
        } finally {
            busy = false
        }
    }
    interval = setInterval(sample, 100)
    const mediaDevices = navigator.mediaDevices
    mediaDevices.addEventListener?.('devicechange', discover)
    discover().catch(() => {})
    const discoveryInterval = setInterval(() => discover().catch(() => {}), 5000)
    return {
        stop() {
            if (stopped) return
            stopped = true
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
