import { acquireDictationStream, rememberLastUsedInputDevice } from '../hooks/rambleMicCapture'
import { keepScreenAwake } from './screenWakeLock'
import { createMeetingChunker, MEETING_SAMPLE_RATE, MEETING_WORKLET } from './meetingAudio'

export function isMeetingCaptureSupported() {
    return (
        typeof window !== 'undefined' &&
        !!window.AudioWorkletNode &&
        !!window.AudioContext &&
        !!navigator.mediaDevices?.getUserMedia &&
        !!navigator.locks?.request &&
        typeof indexedDB !== 'undefined'
    )
}

export function createMeetingCapture({ onChunk, onError, onStopped, onLevel }) {
    let stopped = false
    let stream, context, source, node, releaseWakeLock, timer, moduleUrl
    let stopPromise
    let resolveFlush
    let samples = 0
    let signal = false
    const chunker = createMeetingChunker(onChunk)
    const fail = code => {
        onError(code)
        stop()
    }
    const stop = () => {
        if (stopPromise) return stopPromise
        stopped = true
        clearInterval(timer)
        // Flush the worklet BEFORE disconnecting/stopping tracks, then flush the last WAV.
        stopPromise = (async () => {
            if (node && context.state === 'running') {
                await new Promise(resolve => {
                    const timeout = setTimeout(() => {
                        onError('capture-interrupted')
                        resolve()
                    }, 2000)
                    resolveFlush = () => {
                        clearTimeout(timeout)
                        resolve()
                    }
                    node.port.postMessage('stop')
                })
            }
            chunker.flush()
            node?.disconnect()
            source?.disconnect()
            stream?.getTracks().forEach(track => track.stop())
            releaseWakeLock?.()
            if (context && context.state !== 'closed') await context.close().catch(() => {})
            if (moduleUrl) URL.revokeObjectURL(moduleUrl)
            onStopped()
        })()
        return stopPromise
    }

    return {
        stop,
        async start() {
            try {
                context = new window.AudioContext()
                await context.resume()
                const acquired = await acquireDictationStream({
                    requestStream: audio => navigator.mediaDevices.getUserMedia({ audio }),
                })
                stream = acquired.stream
                acquired.monitor?.close()
                if (stopped) {
                    stream.getTracks().forEach(track => track.stop())
                    return false
                }
                rememberLastUsedInputDevice({ deviceId: acquired.deviceId, label: acquired.deviceLabel })
                moduleUrl = URL.createObjectURL(new Blob([MEETING_WORKLET], { type: 'text/javascript' }))
                await context.audioWorklet.addModule(moduleUrl)
                if (stopped) return false
                node = new window.AudioWorkletNode(context, 'meeting-pcm')
                source = context.createMediaStreamSource(stream)
                node.port.onmessage = ({ data }) => {
                    if (data.stopped) return resolveFlush?.()
                    if (!data.pcm) return
                    const remaining = MEETING_SAMPLE_RATE * 3600 - samples
                    const pcm = data.pcm.subarray(0, remaining)
                    samples += pcm.length
                    chunker.push(pcm)
                    signal = signal || pcm.some(value => Math.abs(value) > 100)
                    if (samples >= MEETING_SAMPLE_RATE * 3600) stop()
                }
                node.onprocessorerror = () => fail('capture-interrupted')
                stream.getAudioTracks().forEach(track => {
                    track.onended = () => fail('capture-interrupted')
                    track.onmute = () => fail('capture-interrupted')
                })
                context.onstatechange = () => {
                    if (!stopped && context.state !== 'running') fail('capture-interrupted')
                }
                // The processor writes no output, so the graph stays alive without mic playback.
                source.connect(node)
                node.connect(context.destination)
                releaseWakeLock = keepScreenAwake()
                timer = setInterval(() => {
                    onLevel?.(signal)
                    signal = false
                    if (stream.getAudioTracks().some(track => track.readyState !== 'live')) fail('capture-interrupted')
                }, 1000)
                return acquired.deviceLabel || ''
            } catch (error) {
                if (!stopped) fail(error.name === 'NotAllowedError' ? 'permission-denied' : 'capture-interrupted')
                await stop()
                return false
            }
        },
    }
}
