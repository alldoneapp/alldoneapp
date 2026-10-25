// Exercise the real dictation button/controller without requesting a hardware microphone.
import { useRef, useState } from 'react'

export const isDictationSupported = () => true

export default function useRambleRecorder({ onComplete }) {
    const [isRecording, setRecording] = useState(false)
    const recording = useRef(false)
    return {
        isRecording,
        elapsedSeconds: isRecording ? 3 : 0,
        getInputLevel: () => 0.12,
        start: () => {
            recording.current = true
            setRecording(true)
        },
        stop: () => {
            if (!recording.current) return false
            recording.current = false
            setRecording(false)
            onComplete({ audioBase64: 'fixture-audio', mimeType: 'audio/webm', durationSeconds: 3 })
            return true
        },
        cancel: () => {
            recording.current = false
            setRecording(false)
        },
    }
}
