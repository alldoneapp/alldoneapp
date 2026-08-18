import { useCallback, useEffect, useRef, useState } from 'react'

import {
    CAPTURE_MODE_PROCESSED,
    CAPTURE_MODE_RAW,
    buildAudioConstraints,
    createInputLevelMonitor,
    getInputDeviceLabel,
    isSilentCapture,
    isTrackMuted,
    readPreferredCaptureMode,
    waitForInputSignal,
    writePreferredCaptureMode,
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
 *   onComplete: (audio: { audioBase64: string, mimeType: string, durationSeconds: number }) => void,
 *   onError: (
 *     code: 'permission-denied' | 'too-large' | 'not-supported' | 'recorder-error'
 *         | 'silent-input-retry' | 'silent-input',
 *     details?: { deviceLabel?: string, captureMode?: string, peak?: number },
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
    const deviceLabelRef = useRef('')

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

        let captureMode = readPreferredCaptureMode()
        let stream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(captureMode) })
        } catch (error) {
            onErrorRef.current?.('permission-denied')
            return
        }

        // Pre-flight: a device that hands us bit-exact silence (or a track Chrome has already
        // flagged as not delivering) is re-acquired with the processing chain switched off before
        // a single byte is recorded, so the broken take never happens. A healthy mic clears this
        // on the first read — the wait is only ever paid by a device that is actually dead.
        let monitor = createInputLevelMonitor(stream)
        if (captureMode === CAPTURE_MODE_PROCESSED) {
            const alive = !isTrackMuted(stream) && (await waitForInputSignal(monitor))
            if (!alive) {
                monitor?.close()
                stream.getTracks().forEach(track => track.stop())
                captureMode = CAPTURE_MODE_RAW
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: buildAudioConstraints(captureMode),
                    })
                } catch (error) {
                    onErrorRef.current?.('permission-denied')
                    return
                }
                monitor = createInputLevelMonitor(stream)
                // Only a device that is silent processed AND alive raw proves the processing path
                // is the broken one; that is what earns a remembered preference.
                if (await waitForInputSignal(monitor)) writePreferredCaptureMode(CAPTURE_MODE_RAW)
            }
        }

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
        deviceLabelRef.current = getInputDeviceLabel(stream)
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
            const deviceLabel = deviceLabelRef.current
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
                captureMode: usedCaptureMode,
                peak,
                deviceLabel,
                blobBytes: blob.size,
                durationSeconds,
            })
            if (isSilentCapture(peak)) {
                // Never upload silence: it costs Gold and comes back as "No speech detected".
                if (usedCaptureMode === CAPTURE_MODE_PROCESSED) {
                    writePreferredCaptureMode(CAPTURE_MODE_RAW)
                    onErrorRef.current?.('silent-input-retry', { deviceLabel, captureMode: usedCaptureMode, peak })
                } else {
                    // Raw capture is silent too, so the remembered workaround is not the answer
                    // here — drop it rather than keeping a degraded mode forever.
                    writePreferredCaptureMode(CAPTURE_MODE_PROCESSED)
                    onErrorRef.current?.('silent-input', { deviceLabel, captureMode: usedCaptureMode, peak })
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
