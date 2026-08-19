import { useCallback, useEffect, useRef, useState } from 'react'

import {
    CAPTURE_MODE_PROCESSED,
    MIC_MODE_AUTO,
    acquireDictationStream,
    forgetLearnedCapture,
    installDeviceChangeInvalidation,
    isSilentCapture,
    rememberLastUsedInputDevice,
    rememberLearnedCaptureMode,
} from './rambleMicCapture'

/**
 * One-shot mic recorder for the rambler dictation feature: start → talk → stop → a single
 * base64-encoded clip. Deliberately NOT the meeting-transcription pipeline (10s chunk recursion,
 * getDisplayMedia, hardcoded webm) — dictation needs only the microphone and one upload.
 *
 * It also verifies that the microphone actually produced sound (AT-2357). A macOS capture that
 * yields digital silence still encodes to a non-empty blob, so without that check the clip is
 * uploaded, billed, and comes back as "No speech detected" from a server that never had any
 * speech to find. See `rambleMicCapture.js` for the mechanism.
 */

export const RAMBLE_MAX_DURATION_SECONDS = 300
// The server rejects base64 payloads over 9M chars; 8MB of raw audio stays under that after the
// ~33% base64 inflation guard is applied server-side to the encoded string.
export const RAMBLE_MAX_AUDIO_BYTES = 8 * 1024 * 1024

// Never hardcode audio/webm: Safari/iOS records audio/mp4 and throws on a webm MediaRecorder.
const MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export function pickSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return undefined
    }
    return MIME_TYPE_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type))
}

export function isDictationSupported() {
    return (
        typeof MediaRecorder !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
    )
}

/**
 * @param {{
 *   onComplete: (
 *     audio: { audioBase64: string, mimeType: string, durationSeconds: number, deviceLabel?: string },
 *   ) => void,
 *   onError: (
 *     code: 'permission-denied' | 'too-large' | 'not-supported' | 'recorder-error'
 *         | 'silent-input-retry' | 'silent-input',
 *     details?: { deviceLabel?: string, captureMode?: string, peak?: number, triedDeviceLabels?: string[] },
 *   ) => void,
 * }} options
 */
export default function useRambleRecorder({ onComplete, onError }) {
    const [isRecording, setIsRecording] = useState(false)
    const [elapsedSeconds, setElapsedSeconds] = useState(0)

    const recorderRef = useRef(null)
    const streamRef = useRef(null)
    const chunksRef = useRef([])
    const timerRef = useRef(null)
    const cancelledRef = useRef(false)
    const startedAtRef = useRef(0)
    const mimeTypeRef = useRef('')
    const monitorRef = useRef(null)
    const levelTimerRef = useRef(null)
    const captureModeRef = useRef(CAPTURE_MODE_PROCESSED)
    const micModeSettingRef = useRef(MIC_MODE_AUTO)
    const deviceIdRef = useRef('')
    const deviceLabelRef = useRef('')
    const triedDevicesRef = useRef([])

    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (levelTimerRef.current) {
            clearInterval(levelTimerRef.current)
            levelTimerRef.current = null
        }
        if (monitorRef.current) {
            monitorRef.current.close()
            monitorRef.current = null
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        recorderRef.current = null
        chunksRef.current = []
        setIsRecording(false)
        setElapsedSeconds(0)
    }, [])

    const stop = useCallback(() => {
        const recorder = recorderRef.current
        if (!recorder || recorder.state === 'inactive') return
        recorder.stop()
    }, [])

    const cancel = useCallback(() => {
        cancelledRef.current = true
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop()
        } else {
            cleanup()
        }
    }, [cleanup])

    const stopRef = useRef(stop)
    stopRef.current = stop

    const start = useCallback(async () => {
        if (recorderRef.current) return
        if (!isDictationSupported()) {
            onErrorRef.current?.('not-supported')
            return
        }

        // Acquisition owns the capture-mode decision: the user's setting, the remembered
        // workaround (and whether it still belongs to this device), and the pre-flight probe that
        // re-acquires a silent device with processing disabled BEFORE recording starts, so the
        // broken take never happens and no speech is lost. See rambleMicCapture.js.
        let acquired
        try {
            acquired = await acquireDictationStream({
                requestStream: audio => navigator.mediaDevices.getUserMedia({ audio }),
            })
        } catch (error) {
            onErrorRef.current?.('permission-denied')
            return
        }
        const { stream, monitor, captureMode, setting, deviceId, deviceLabel, triedDevices, switchedDevice } = acquired

        const mimeType = pickSupportedMimeType()
        let recorder
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
        } catch (error) {
            monitor?.close()
            stream.getTracks().forEach(track => track.stop())
            onErrorRef.current?.('not-supported')
            return
        }

        monitorRef.current = monitor
        captureModeRef.current = captureMode
        micModeSettingRef.current = setting
        deviceIdRef.current = deviceId
        deviceLabelRef.current = deviceLabel
        triedDevicesRef.current = triedDevices || []
        // Diagnostic only: the Settings picker shows this so "System default" is not a black box.
        // Which microphone the browser hands us is otherwise only visible in the DevTools console.
        rememberLastUsedInputDevice({ deviceId, label: deviceLabel })
        if (switchedDevice) {
            // Worth a line of its own: from here on the recording is NOT coming from the microphone
            // the browser would have chosen, which is the single most confusing thing about this
            // failure class when it is reported.
            console.log('[rambler] switched input device', { deviceLabel, deviceId, tried: triedDevices })
        }
        cancelledRef.current = false
        chunksRef.current = []
        mimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
        streamRef.current = stream
        recorderRef.current = recorder
        startedAtRef.current = Date.now()

        recorder.ondataavailable = event => {
            if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.onerror = () => {
            cancelledRef.current = true
            onErrorRef.current?.('recorder-error')
            if (recorder.state !== 'inactive') recorder.stop()
            else cleanup()
        }
        recorder.onstop = () => {
            const wasCancelled = cancelledRef.current
            const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000)
            const chunks = chunksRef.current
            const recordedMimeType = mimeTypeRef.current
            // Read the peak BEFORE cleanup tears the analyser down; `null` means we could not
            // measure at all (no Web Audio), which never blocks the upload.
            const peak = monitorRef.current ? monitorRef.current.sample() : null
            const usedCaptureMode = captureModeRef.current
            const usedMicModeSetting = micModeSettingRef.current
            const usedDeviceId = deviceIdRef.current
            const deviceLabel = deviceLabelRef.current
            const triedDeviceLabels = (triedDevicesRef.current || []).map(device => device.label).filter(Boolean)
            cleanup()
            if (wasCancelled) return

            const blob = new Blob(chunks, { type: recordedMimeType })
            if (!blob.size) {
                onErrorRef.current?.('recorder-error')
                return
            }
            // Diagnostics for the next report of this class: a silent take is obvious here and
            // nowhere else (the blob is non-empty and the server error is generic).
            console.log('[rambler] capture', {
                micModeSetting: usedMicModeSetting,
                captureMode: usedCaptureMode,
                peak,
                deviceLabel,
                deviceId: usedDeviceId,
                triedDeviceLabels,
                blobBytes: blob.size,
                durationSeconds,
            })
            if (isSilentCapture(peak)) {
                // Never upload silence: it costs Gold and comes back as "No speech detected".
                const details = { deviceLabel, captureMode: usedCaptureMode, peak, triedDeviceLabels }
                // An explicit user setting is reported, never overridden — the whole point of the
                // setting is that the automatic path stops making decisions for them.
                if (usedMicModeSetting !== MIC_MODE_AUTO) {
                    onErrorRef.current?.('silent-input', details)
                } else if (usedCaptureMode === CAPTURE_MODE_PROCESSED) {
                    // The probe let this through (it went dead mid-take, or its noise floor was
                    // non-zero); the completed take is the stronger signal, so learn from it.
                    rememberLearnedCaptureMode({ deviceId: usedDeviceId, deviceLabel })
                    onErrorRef.current?.('silent-input-retry', details)
                } else {
                    // Raw capture is silent too, so neither the remembered mode nor the remembered
                    // device is the answer here — drop both rather than keeping a degraded, wrong
                    // configuration forever. The next recording starts from a clean slate.
                    forgetLearnedCapture()
                    onErrorRef.current?.('silent-input', details)
                }
                return
            }
            if (blob.size > RAMBLE_MAX_AUDIO_BYTES) {
                onErrorRef.current?.('too-large')
                return
            }
            const reader = new FileReader()
            reader.onloadend = () => {
                if (typeof reader.result === 'string' && reader.result.length > 0) {
                    onCompleteRef.current?.({
                        audioBase64: reader.result,
                        mimeType: recordedMimeType,
                        durationSeconds,
                        // Carried through so a server-side "no speech" can name the microphone it
                        // actually listened to: a device that is alive but WRONG passes every local
                        // check — it records the room while the user talks into another mic.
                        deviceLabel,
                    })
                } else {
                    onErrorRef.current?.('recorder-error')
                }
            }
            reader.readAsDataURL(blob)
        }

        // 1s timeslices so a mid-recording crash loses at most a second, and Safari (which is
        // unreliable about a single final dataavailable) still delivers steady chunks.
        recorder.start(1000)
        setIsRecording(true)
        setElapsedSeconds(0)
        // Sampled far faster than the 1s UI tick: the analyser only ever holds ~43ms of audio, so
        // a slow poll would step over the gaps between words and under-report the peak.
        if (monitorRef.current) {
            levelTimerRef.current = setInterval(() => {
                monitorRef.current?.sample()
            }, 100)
        }
        timerRef.current = setInterval(() => {
            setElapsedSeconds(previous => {
                const next = previous + 1
                if (next >= RAMBLE_MAX_DURATION_SECONDS) stopRef.current()
                return next
            })
        }, 1000)
    }, [cleanup])

    // Plugging in headphones or switching the system default retires a learned workaround, so the
    // capture mode follows the hardware instead of outliving it.
    useEffect(() => installDeviceChangeInvalidation(), [])

    useEffect(() => {
        return () => {
            cancelledRef.current = true
            const recorder = recorderRef.current
            if (recorder && recorder.state !== 'inactive') recorder.stop()
            if (timerRef.current) clearInterval(timerRef.current)
            if (levelTimerRef.current) clearInterval(levelTimerRef.current)
            if (monitorRef.current) monitorRef.current.close()
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop())
        }
    }, [])

    return { isRecording, elapsedSeconds, start, stop, cancel }
}
