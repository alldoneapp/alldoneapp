import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One-shot mic recorder for the rambler dictation feature: start → talk → stop → a single
 * base64-encoded clip. Deliberately NOT the meeting-transcription pipeline (10s chunk recursion,
 * getDisplayMedia, hardcoded webm) — dictation needs only the microphone and one upload.
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
 *   onError: (code: 'permission-denied' | 'too-large' | 'not-supported' | 'recorder-error') => void,
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

    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
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

        let stream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (error) {
            onErrorRef.current?.('permission-denied')
            return
        }

        const mimeType = pickSupportedMimeType()
        let recorder
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
        } catch (error) {
            stream.getTracks().forEach(track => track.stop())
            onErrorRef.current?.('not-supported')
            return
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
            cleanup()
            if (wasCancelled) return

            const blob = new Blob(chunks, { type: recordedMimeType })
            if (!blob.size) {
                onErrorRef.current?.('recorder-error')
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
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop())
        }
    }, [])

    return { isRecording, elapsedSeconds, start, stop, cancel }
}
