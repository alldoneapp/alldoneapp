// Continuous PCM capture avoids both undecodable MediaRecorder timeslice fragments and
// stop/restart gaps. Every queued file is a complete mono 16-bit, 16kHz WAV.
export const MEETING_SAMPLE_RATE = 16000
export const MEETING_CHUNK_SAMPLES = MEETING_SAMPLE_RATE * 10

// Runs on the audio rendering thread. Send 100ms at a time, not one message per 128 frames.
// The accumulator downsamples 44.1/48kHz inputs without resetting at chunk boundaries.
export const MEETING_WORKLET = `
class MeetingPCM extends AudioWorkletProcessor {
    constructor() {
        super()
        this.buffer = new Int16Array(1600)
        this.used = 0
        this.phase = 0
        this.sum = 0
        this.count = 0
        this.stopped = false
        this.port.onmessage = () => {
            if (this.used) this.port.postMessage({ pcm: this.buffer.slice(0, this.used) })
            this.stopped = true
            this.port.postMessage({ stopped: true })
        }
    }
    process(inputs) {
        if (this.stopped) return false
        const channels = inputs[0]
        if (!channels || !channels.length) return true
        for (let i = 0; i < channels[0].length; i++) {
            let value = 0
            for (const channel of channels) value += channel[i] / channels.length
            this.sum += value
            this.count++
            this.phase += 16000
            if (this.phase >= sampleRate) {
                this.phase -= sampleRate
                const sample = Math.max(-1, Math.min(1, this.sum / this.count))
                this.buffer[this.used++] = Math.round(sample * (sample < 0 ? 32768 : 32767))
                this.sum = this.count = 0
                if (this.used === this.buffer.length) {
                    this.port.postMessage({ pcm: this.buffer })
                    this.buffer = new Int16Array(1600)
                    this.used = 0
                }
            }
        }
        return true
    }
}
registerProcessor('meeting-pcm', MeetingPCM)
`

export function encodeMeetingWav(samples) {
    const bytes = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(bytes)
    const label = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
    label(0, 'RIFF')
    view.setUint32(4, bytes.byteLength - 8, true)
    label(8, 'WAVE')
    label(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, MEETING_SAMPLE_RATE, true)
    view.setUint32(28, MEETING_SAMPLE_RATE * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    label(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true))
    return new Blob([bytes], { type: 'audio/wav' })
}

export function createMeetingChunker(onChunk) {
    let buffer = new Int16Array(MEETING_CHUNK_SAMPLES)
    let used = 0
    const flush = () => {
        if (used) onChunk(encodeMeetingWav(buffer.subarray(0, used)))
        buffer = new Int16Array(MEETING_CHUNK_SAMPLES)
        used = 0
    }
    return {
        push(samples) {
            let offset = 0
            while (offset < samples.length) {
                const count = Math.min(buffer.length - used, samples.length - offset)
                buffer.set(samples.subarray(offset, offset + count), used)
                used += count
                offset += count
                if (used === buffer.length) flush()
            }
        },
        flush,
    }
}

export function meetingBlobBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error)
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
    })
}
