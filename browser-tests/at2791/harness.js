import { createMeetingCapture } from '../../utils/meetingCapture.js'
import { openMeetingQueue, drainMeetingQueue } from '../../utils/meetingQueue.js'

// Browser integration with GENERATED sound. This never opens a hardware microphone,
// talks to Firebase/Deepgram or spends Gold.
window.startTest = async () => {
    const sound = new AudioContext()
    await sound.resume()
    const oscillator = sound.createOscillator()
    oscillator.frequency.value = 440
    const destination = sound.createMediaStreamDestination()
    oscillator.connect(destination)
    oscillator.start()
    navigator.mediaDevices.getUserMedia = async () => destination.stream
    const queue = await openMeetingQueue()
    const blobs = []
    const errors = []
    let writes = Promise.resolve()
    const capture = createMeetingCapture({
        onChunk: blob => {
            const sequence = blobs.length
            blobs.push(blob)
            writes = writes.then(() =>
                queue.enqueue({
                    id: `browser:${sequence}`,
                    owner: 'test:note',
                    sequence,
                    sessionId: 'browser',
                    createdAt: 1,
                    blob,
                })
            )
        },
        onError: error => errors.push(error),
        onStopped: () => {},
    })
    await capture.start()
    window.stopTest = async () => {
        await Promise.all([capture.stop(), capture.stop()])
        await writes
        const decoder = new AudioContext({ sampleRate: 16000 })
        const decoded = []
        for (const blob of blobs) {
            const bytes = await blob.arrayBuffer()
            const view = new DataView(bytes)
            const sampleRate = view.getUint32(24, true)
            const audio = await decoder.decodeAudioData(bytes)
            decoded.push({
                sampleRate,
                frames: audio.length,
                peak: Math.max(...audio.getChannelData(0).subarray(0, 16000)),
            })
        }
        await decoder.close()
        oscillator.stop()
        await sound.close()
        queue.close()
        return {
            decoded,
            errors,
            tracksStopped: destination.stream.getTracks().every(track => track.readyState === 'ended'),
        }
    }
}

window.recoverTest = async () => {
    const queue = await openMeetingQueue()
    const rows = await queue.list('test:note')
    const order = []
    let offline = true
    const applied = new Set()
    const options = {
        queue,
        owner: 'test:note',
        transcribe: async chunk => {
            if (offline) throw new Error('offline')
            return `text-${chunk.sequence}`
        },
        persist: async chunk => {
            if (!applied.has(chunk.id)) {
                applied.add(chunk.id)
                order.push(chunk.sequence)
            }
            return true
        },
    }
    try {
        await drainMeetingQueue(options)
    } catch (_) {}
    const offlineRetained = (await queue.list('test:note')).length
    offline = false
    await drainMeetingQueue(options)
    const remaining = (await queue.list('test:note')).length
    queue.close()
    return { restored: rows.length, offlineRetained, remaining, order }
}
