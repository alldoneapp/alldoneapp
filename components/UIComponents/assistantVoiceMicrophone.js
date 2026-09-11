import {
    createInputLevelMonitor,
    getInputDeviceId,
    getInputDeviceLabel,
    getInputGroupId,
    listAudioInputDevices,
} from '../../hooks/rambleMicCapture'

const stop = stream => stream?.getTracks?.().forEach(track => track.stop())
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const cancelledError = () => new Error('voice_start_cancelled')

// Compare the same time window on all inputs. A sustained level wins over a
// single click; silence keeps the browser default. No samples leave this device.
export function microphoneScore(levels) {
    const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b)
    return sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.8)] : 0
}

export async function acquireVoiceMicrophone({ isCancelled = () => false, onChecking = () => {} } = {}) {
    const captures = []
    let selected
    const check = () => {
        if (isCancelled()) throw cancelledError()
    }
    const add = stream => {
        const capture = { stream, monitor: createInputLevelMonitor(stream), levels: [], raw: false }
        captures.push(capture)
        return capture
    }
    try {
        // Ask permission first, before enumeration (Chrome hides labels otherwise).
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        })
        const first = add(stream)
        check()
        if (!first.monitor) {
            selected = first
            await Promise.resolve(stream.getAudioTracks()[0]?.applyConstraints?.({ autoGainControl: true })).catch(
                () => {}
            )
            check()
            return { stream, deviceLabel: getInputDeviceLabel(stream), measured: false }
        }
        onChecking()
        const devices = await listAudioInputDevices()
        check()
        const ids = new Set([getInputDeviceId(stream), 'default', 'communications', ''])
        const groups = new Set([getInputGroupId(stream)].filter(Boolean))
        const candidates = devices.filter(device => {
            if (ids.has(device.deviceId) || (device.groupId && groups.has(device.groupId))) return false
            ids.add(device.deviceId)
            if (device.groupId) groups.add(device.groupId)
            return true
        })
        await Promise.all(
            candidates.map(async device => {
                let expired = false
                let timer
                // A disconnected USB/virtual input must not hold up every other mic.
                const pending = navigator.mediaDevices
                    .getUserMedia({
                        audio: {
                            deviceId: { exact: device.deviceId },
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: false,
                        },
                    })
                    .then(candidate => {
                        if (expired || isCancelled()) {
                            stop(candidate)
                            return null
                        }
                        return add(candidate)
                    })
                try {
                    await Promise.race([
                        pending,
                        new Promise(resolve => {
                            timer = setTimeout(() => {
                                expired = true
                                resolve()
                            }, 2500)
                        }),
                    ])
                } catch (_) {
                    /* Busy, unplugged or denied inputs do not break a working default. */
                } finally {
                    clearTimeout(timer)
                }
            })
        )
        check()
        await Promise.race([Promise.all(captures.map(c => c.monitor?.ready)), delay(700)])
        const measure = async rounds => {
            for (let i = 0; i < rounds; i++) {
                check()
                for (const capture of captures) {
                    capture.monitor?.sample()
                    capture.levels.push(capture.monitor?.getLevel() || 0)
                }
                await delay(50)
            }
        }
        await measure(24)
        // Chrome/macOS can send bit-exact zeros with audio processing enabled.
        // Only try compatibility capture when every available input is silent.
        if (captures.every(c => !c.monitor?.getPeak())) {
            await Promise.all(
                captures.map(async capture => {
                    const deviceId = getInputDeviceId(capture.stream)
                    capture.monitor?.close()
                    capture.monitor = null
                    stop(capture.stream)
                    let expired = false
                    let timer
                    try {
                        const pending = navigator.mediaDevices
                            .getUserMedia({
                                audio: {
                                    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
                                    echoCancellation: false,
                                    noiseSuppression: false,
                                    autoGainControl: false,
                                },
                            })
                            .then(raw => {
                                if (expired || isCancelled()) {
                                    stop(raw)
                                    return
                                }
                                capture.stream = raw
                                capture.monitor = createInputLevelMonitor(raw)
                                capture.raw = true
                                capture.levels = []
                            })
                        await Promise.race([
                            pending,
                            new Promise(resolve => {
                                timer = setTimeout(() => {
                                    expired = true
                                    resolve()
                                }, 2500)
                            }),
                        ])
                    } catch (_) {
                        /* Other available devices may still work. */
                    } finally {
                        clearTimeout(timer)
                    }
                })
            )
            await Promise.race([Promise.all(captures.map(c => c.monitor?.ready)), delay(700)])
            await measure(12)
        }
        check()
        selected = captures.reduce((best, candidate) => {
            const track = candidate.stream.getAudioTracks()[0]
            if (track?.readyState === 'ended' || track?.muted) return best
            const bestTrack = best.stream.getAudioTracks()[0]
            return bestTrack?.readyState === 'ended' ||
                bestTrack?.muted ||
                microphoneScore(candidate.levels) > microphoneScore(best.levels)
                ? candidate
                : best
        }, first)
        if (selected.stream.getAudioTracks()[0]?.readyState === 'ended') throw new Error('No usable microphone')
        if (!selected.raw)
            await Promise.resolve(
                selected.stream.getAudioTracks()[0]?.applyConstraints?.({ autoGainControl: true })
            ).catch(() => {})
        check()
        return {
            stream: selected.stream,
            deviceLabel: getInputDeviceLabel(selected.stream),
            measured: true,
            hasSignal: selected.monitor?.getPeak() > 0,
            compatibilityMode: selected.raw,
        }
    } catch (error) {
        selected = null
        throw error
    } finally {
        for (const capture of captures) {
            capture.monitor?.close()
            if (capture !== selected) stop(capture.stream)
        }
    }
}
