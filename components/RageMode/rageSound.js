/**
 * Rage mode's sound: synthesised with Web Audio, so the chunk ships no audio files. The mute choice
 * is remembered per browser (a convenience; every storage access is guarded).
 */

const MUTE_KEY = 'alldone.rageMode.muted'

const readMuted = () => {
    try {
        return window.localStorage.getItem(MUTE_KEY) === '1'
    } catch (error) {
        return false
    }
}

export const writeMuted = muted => {
    try {
        if (muted) window.localStorage.setItem(MUTE_KEY, '1')
        else window.localStorage.removeItem(MUTE_KEY)
    } catch (error) {
        // Remembering the mute button is a convenience; the arena works without it.
    }
}

export const createSound = () => {
    let context = null
    let noise = null
    let lastBoom = 0
    const ensure = () => {
        if (context) return context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        if (!AudioContextClass) return null
        context = new AudioContextClass()
        const length = Math.floor(context.sampleRate * 0.4)
        noise = context.createBuffer(1, length, context.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
        return context
    }
    return {
        muted: readMuted(),
        unlock() {
            const ctx = ensure()
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
        },
        pew(volume = 1) {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'square'
            osc.frequency.setValueAtTime(1100 + Math.random() * 200, now)
            osc.frequency.exponentialRampToValueAtTime(170, now + 0.1)
            gain.gain.setValueAtTime(0.045 * volume, now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
            osc.connect(gain).connect(ctx.destination)
            osc.start(now)
            osc.stop(now + 0.12)
        },
        boom(size = 1) {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            // Many hits land in the same frame; a wall of simultaneous noise bursts just clips.
            if (now - lastBoom < 0.035) return
            lastBoom = now
            const source = ctx.createBufferSource()
            source.buffer = noise
            const filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(1800 * size, now)
            filter.frequency.exponentialRampToValueAtTime(120, now + 0.25)
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(0.16 * Math.min(1.5, size), now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
            source.connect(filter).connect(gain).connect(ctx.destination)
            source.start(now)
            source.stop(now + 0.32)
        },
        // A rising two-note chime: a power-up picked up.
        chime() {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            ;[880, 1320].forEach((frequency, i) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = 'sine'
                osc.frequency.setValueAtTime(frequency, now + i * 0.07)
                gain.gain.setValueAtTime(0.0001, now + i * 0.07)
                gain.gain.exponentialRampToValueAtTime(0.09, now + i * 0.07 + 0.02)
                gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.22)
                osc.connect(gain).connect(ctx.destination)
                osc.start(now + i * 0.07)
                osc.stop(now + i * 0.07 + 0.24)
            })
        },
        hurt() {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sawtooth'
            osc.frequency.setValueAtTime(220, now)
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.25)
            gain.gain.setValueAtTime(0.12, now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
            osc.connect(gain).connect(ctx.destination)
            osc.start(now)
            osc.stop(now + 0.3)
        },
        close() {
            if (context && context.close) context.close().catch(() => {})
            context = null
        },
    }
}
