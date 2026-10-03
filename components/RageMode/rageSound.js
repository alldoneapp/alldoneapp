/**
 * Rage mode's sound: synthesised with Web Audio, so the chunk ships no audio files. The mute choice
 * is remembered per browser (a convenience; every storage access is guarded).
 *
 * One small mix bus: everything goes through a compressor (so a screen full of explosions swells
 * instead of clipping), and big things also send into a short generated reverb, which is what gives
 * an explosion or a boss arrival its sense of space. Variety comes from tiny random detunes on
 * every call — the hundredth shot does not sound like a loop — and from each kind of event having
 * its own voice: weapons, the cast, power-ups, the bosses' signatures, the run-up and the music
 * stings at mission start, mission complete and game over. Rapid-fire events are rate-limited.
 *
 * Without Web Audio (jsdom, some locked-down browsers) every call is a no-op.
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

// Minimum seconds between two plays of the same sound: auto-fire and swarms would otherwise be noise.
export const RATE_LIMITS = {
    gun: 0.07,
    enemyShot: 0.09,
    explosion: 0.03,
    hurt: 0.12,
    alarm: 1.1,
    step: 0.06,
    flame: 0.08,
    tick: 0.5,
    combo: 0.1,
    pickup: 0.05,
    beamWarn: 0.15,
    beamFire: 0.1,
    wave: 0.2,
    mine: 0.25,
}

// Notes for the stings and chimes (Hz).
const NOTE = {
    C4: 261.63,
    E4: 329.63,
    G4: 392,
    A4: 440,
    B4: 493.88,
    C5: 523.25,
    D5: 587.33,
    E5: 659.25,
    G5: 783.99,
    A5: 880,
    C6: 1046.5,
    E6: 1318.51,
}

const vary = (value, amount) => value * (1 + (Math.random() * 2 - 1) * amount)

export const createSound = () => {
    let context = null
    let master = null
    let reverb = null
    let noise = null
    const last = {}
    const loops = {}

    const ensure = () => {
        if (context) return context
        const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
        if (!AudioContextClass) return null
        try {
            context = new AudioContextClass()
        } catch (error) {
            return null
        }
        const length = Math.floor(context.sampleRate * 1.2)
        noise = context.createBuffer(1, length, context.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
        // The bus: everything → compressor → output, plus a reverb send for the big moments.
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.setValueAtTime(-16, context.currentTime)
        compressor.ratio.setValueAtTime(6, context.currentTime)
        compressor.attack.setValueAtTime(0.004, context.currentTime)
        compressor.release.setValueAtTime(0.2, context.currentTime)
        master = context.createGain()
        master.gain.setValueAtTime(0.9, context.currentTime)
        master.connect(compressor).connect(context.destination)
        const impulseLength = Math.floor(context.sampleRate * 1.6)
        const impulse = context.createBuffer(2, impulseLength, context.sampleRate)
        for (let channel = 0; channel < 2; channel++) {
            const samples = impulse.getChannelData(channel)
            for (let i = 0; i < impulseLength; i++)
                samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 3)
        }
        const convolver = context.createConvolver()
        convolver.buffer = impulse
        reverb = context.createGain()
        reverb.gain.setValueAtTime(0.35, context.currentTime)
        reverb.connect(convolver).connect(master)
        return context
    }

    // Returns the context and its clock when this sound may play now, else null.
    const begin = (name, minGap = RATE_LIMITS[name] || 0) => {
        if (api.muted) return null
        const ctx = ensure()
        if (!ctx) return null
        const now = ctx.currentTime
        if (minGap && last[name] !== undefined && now - last[name] < minGap) return null
        last[name] = now
        return { ctx, now }
    }

    const envelope = (ctx, at, peak, attack, release) => {
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release)
        return gain
    }

    /** One oscillator note, optionally gliding to `to`. */
    const tone = (ctx, at, { type = 'sine', freq, to, dur = 0.2, gain = 0.1, attack = 0.005, send = 0 }) => {
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.setValueAtTime(freq, at)
        if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur)
        const amp = envelope(ctx, at, gain, attack, dur)
        osc.connect(amp).connect(master)
        if (send) {
            const wet = ctx.createGain()
            wet.gain.setValueAtTime(send, at)
            amp.connect(wet).connect(reverb)
        }
        osc.start(at)
        osc.stop(at + attack + dur + 0.05)
    }

    /** A burst of filtered noise, optionally sweeping the filter from `freq` to `to`. */
    const hiss = (
        ctx,
        at,
        { filter = 'lowpass', freq = 2000, to, q = 0.8, dur = 0.3, gain = 0.15, attack = 0.004, send = 0 }
    ) => {
        const source = ctx.createBufferSource()
        source.buffer = noise
        source.playbackRate.setValueAtTime(vary(1, 0.1), at)
        const shaper = ctx.createBiquadFilter()
        shaper.type = filter
        shaper.Q.setValueAtTime(q, at)
        shaper.frequency.setValueAtTime(freq, at)
        if (to) shaper.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur)
        const amp = envelope(ctx, at, gain, attack, dur)
        source.connect(shaper).connect(amp).connect(master)
        if (send) {
            const wet = ctx.createGain()
            wet.gain.setValueAtTime(send, at)
            amp.connect(wet).connect(reverb)
        }
        source.start(at, Math.random() * 0.5)
        source.stop(at + attack + dur + 0.05)
    }

    const arpeggio = (ctx, at, notes, { type = 'triangle', step = 0.09, dur = 0.22, gain = 0.08, send = 0.3 } = {}) =>
        notes.forEach((freq, i) => tone(ctx, at + i * step, { type, freq, dur, gain, send }))

    const stopLoop = name => {
        const loop = loops[name]
        if (!loop) return
        delete loops[name]
        try {
            const at = context.currentTime
            loop.gain.gain.cancelScheduledValues(at)
            loop.gain.gain.setValueAtTime(loop.gain.gain.value, at)
            loop.gain.gain.linearRampToValueAtTime(0.0001, at + 0.15)
            loop.nodes.forEach(node => node.stop && node.stop(at + 0.2))
        } catch (error) {
            // Already stopped.
        }
    }

    const api = {
        muted: readMuted(),
        unlock() {
            const ctx = ensure()
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
        },
        setMuted(value) {
            api.muted = value
            if (value) Object.keys(loops).forEach(stopLoop)
        },

        /* Anna's weapons. */
        // The main gun: a short bright blip, a touch higher with every cannon upgrade.
        gun(level = 1) {
            const go = begin('gun')
            if (!go) return
            const { ctx, now } = go
            const base = vary(1500 + level * 160, 0.06)
            tone(ctx, now, { type: 'square', freq: base, to: base * 0.32, dur: 0.07, gain: 0.025 })
            tone(ctx, now, { type: 'sine', freq: base * 0.5, to: base * 0.2, dur: 0.06, gain: 0.03 })
        },
        // Specials each sound like what they are.
        weapon(kind) {
            const go = begin(`weapon-${kind}`, kind === 'flame' ? RATE_LIMITS.flame : 0.05)
            if (!go) return
            const { ctx, now } = go
            switch (kind) {
                case 'bolt': // shotgun: a crack and a thump
                    hiss(ctx, now, { filter: 'bandpass', freq: vary(2400, 0.1), q: 0.7, dur: 0.12, gain: 0.16 })
                    tone(ctx, now, { type: 'sine', freq: 140, to: 50, dur: 0.12, gain: 0.12 })
                    break
                case 'rocket': // a whoosh away
                    hiss(ctx, now, { filter: 'bandpass', freq: 400, to: 3200, q: 2, dur: 0.45, gain: 0.08 })
                    tone(ctx, now, { type: 'sawtooth', freq: 90, to: 160, dur: 0.3, gain: 0.03 })
                    break
                case 'flame':
                    hiss(ctx, now, { filter: 'lowpass', freq: vary(900, 0.3), dur: 0.12, gain: 0.05, attack: 0.02 })
                    break
                case 'blackhole': // a falling wobble
                    tone(ctx, now, { type: 'sine', freq: 420, to: 60, dur: 0.9, gain: 0.08, send: 0.4 })
                    tone(ctx, now, { type: 'triangle', freq: 433, to: 63, dur: 0.9, gain: 0.05 })
                    break
                case 'implode':
                    hiss(ctx, now, { filter: 'lowpass', freq: 200, to: 3000, dur: 0.3, gain: 0.18, send: 0.5 })
                    tone(ctx, now, { type: 'sine', freq: 60, to: 30, dur: 0.6, gain: 0.2 })
                    break
                case 'snap': // a crisp click, then everything goes
                    hiss(ctx, now, { filter: 'highpass', freq: 3000, dur: 0.03, gain: 0.3 })
                    hiss(ctx, now + 0.05, { filter: 'lowpass', freq: 6000, to: 80, dur: 1.2, gain: 0.2, send: 0.6 })
                    tone(ctx, now + 0.05, { type: 'sine', freq: 880, to: 55, dur: 1, gain: 0.08, send: 0.5 })
                    break
                default:
                    break
            }
        },
        // The laser hums while it is on.
        laser(on) {
            if (!on || api.muted) {
                stopLoop('laser')
                return
            }
            if (loops.laser) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(0.0001, now)
            gain.gain.linearRampToValueAtTime(0.045, now + 0.08)
            const a = ctx.createOscillator()
            const b = ctx.createOscillator()
            a.type = 'sawtooth'
            b.type = 'square'
            a.frequency.setValueAtTime(220, now)
            b.frequency.setValueAtTime(331, now)
            const filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(1800, now)
            a.connect(filter)
            b.connect(filter)
            filter.connect(gain).connect(master)
            a.start(now)
            b.start(now)
            loops.laser = { gain, nodes: [a, b] }
        },

        /* Hits and explosions. */
        // Small things pop, big things boom and rumble.
        explosion(size = 1) {
            const go = begin('explosion')
            if (!go) return
            const { ctx, now } = go
            const big = Math.min(2.5, size)
            hiss(ctx, now, {
                filter: 'lowpass',
                freq: vary(2400 + 1200 * big, 0.15),
                to: 90,
                dur: 0.18 + 0.22 * big,
                gain: 0.1 + 0.06 * big,
                send: big > 1 ? 0.35 : 0.1,
            })
            tone(ctx, now, {
                type: 'sine',
                freq: vary(120 - 25 * big, 0.1),
                to: 35,
                dur: 0.15 + 0.2 * big,
                gain: 0.1 + 0.08 * big,
            })
            if (big >= 1.5)
                hiss(ctx, now + 0.06, { filter: 'lowpass', freq: 400, to: 60, dur: 0.9, gain: 0.08, send: 0.5 })
        },
        // A hit that did not kill: a short metallic tick.
        hit() {
            const go = begin('hit', 0.04)
            if (!go) return
            tone(go.ctx, go.now, { type: 'triangle', freq: vary(2200, 0.15), to: 1400, dur: 0.04, gain: 0.025 })
        },
        hurt() {
            const go = begin('hurt')
            if (!go) return
            const { ctx, now } = go
            tone(ctx, now, { type: 'sawtooth', freq: vary(240, 0.05), to: 70, dur: 0.28, gain: 0.1 })
            hiss(ctx, now, { filter: 'bandpass', freq: 900, q: 1.5, dur: 0.15, gain: 0.08 })
        },
        // Low shield: a two-tone warning, now and then.
        alarm() {
            const go = begin('alarm')
            if (!go) return
            tone(go.ctx, go.now, { type: 'square', freq: 880, dur: 0.1, gain: 0.03 })
            tone(go.ctx, go.now + 0.14, { type: 'square', freq: 660, dur: 0.1, gain: 0.03 })
        },
        // The mega bomb: a deep whump, a rising rush and a long tail.
        bomb() {
            const go = begin('bomb', 0.2)
            if (!go) return
            const { ctx, now } = go
            tone(ctx, now, { type: 'sine', freq: 90, to: 28, dur: 1.2, gain: 0.3, send: 0.4 })
            hiss(ctx, now, { filter: 'lowpass', freq: 5000, to: 100, dur: 1.4, gain: 0.25, send: 0.6 })
            hiss(ctx, now + 0.05, { filter: 'bandpass', freq: 300, to: 4000, q: 1.2, dur: 0.5, gain: 0.08 })
        },

        /* The cast. */
        enemyShot(kind) {
            const go = begin('enemyShot')
            if (!go) return
            const { ctx, now } = go
            switch (kind) {
                case 'chat': // a quick double chirp
                    tone(ctx, now, { type: 'sine', freq: vary(1100, 0.05), to: 1500, dur: 0.05, gain: 0.025 })
                    tone(ctx, now + 0.06, { type: 'sine', freq: vary(1300, 0.05), to: 1700, dur: 0.05, gain: 0.02 })
                    break
                case 'meeting': // a soft gong-like whomp
                    tone(ctx, now, { type: 'triangle', freq: 180, to: 120, dur: 0.35, gain: 0.06, send: 0.3 })
                    break
                case 'deadline':
                case 'boss':
                    tone(ctx, now, { type: 'square', freq: vary(520, 0.04), to: 260, dur: 0.06, gain: 0.018 })
                    break
                default:
                    tone(ctx, now, { type: 'sawtooth', freq: vary(420, 0.06), to: 180, dur: 0.09, gain: 0.025 })
            }
        },
        // A mine arming: urgent beeps.
        mine() {
            const go = begin('mine')
            if (!go) return
            ;[0, 0.12, 0.24].forEach(at =>
                tone(go.ctx, go.now + at, { type: 'square', freq: 1600, dur: 0.05, gain: 0.03 })
            )
        },
        // A new kind of enemy announced: a short questioning two-note.
        announce() {
            const go = begin('announce', 0.5)
            if (!go) return
            arpeggio(go.ctx, go.now, [NOTE.E5, NOTE.A4], {
                type: 'square',
                step: 0.12,
                dur: 0.12,
                gain: 0.03,
                send: 0.2,
            })
        },

        /* Power-ups and score. */
        pickup(id) {
            const go = begin('pickup')
            if (!go) return
            const { ctx, now } = go
            const chords = {
                coffee: [NOTE.C5, NOTE.G5, NOTE.C6],
                spread: [NOTE.E5, NOTE.A5, NOTE.E6],
                shield: [NOTE.G4, NOTE.D5, NOTE.G5],
                repair: [NOTE.C5, NOTE.E5, NOTE.G5],
                drones: [NOTE.A4, NOTE.E5, NOTE.A5],
                slowmo: [NOTE.C6, NOTE.G5, NOTE.C5],
                star: [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6],
                magnet: [NOTE.G4, NOTE.C5, NOTE.G5],
            }
            if (id === 'bomb') {
                tone(ctx, now, { type: 'triangle', freq: 220, to: 110, dur: 0.18, gain: 0.1 })
                tone(ctx, now + 0.1, { type: 'triangle', freq: 330, dur: 0.15, gain: 0.07 })
                return
            }
            if (id === 'credits') {
                // Coins: two bright pings.
                tone(ctx, now, { type: 'square', freq: 1976, dur: 0.06, gain: 0.04 })
                tone(ctx, now + 0.07, { type: 'square', freq: 2637, dur: 0.18, gain: 0.04, send: 0.2 })
                return
            }
            arpeggio(ctx, now, chords[id] || [NOTE.C5, NOTE.E5, NOTE.G5], {
                type: id === 'shield' ? 'sine' : 'triangle',
                step: id === 'star' ? 0.05 : 0.07,
                dur: 0.2,
                gain: 0.07,
                send: 0.35,
            })
        },
        // Every step up the combo ladder sounds a little higher.
        combo(multiplier) {
            const go = begin('combo')
            if (!go) return
            const base = 600 * Math.pow(1.12, Math.round((multiplier - 1) * 4))
            tone(go.ctx, go.now, { type: 'triangle', freq: base, dur: 0.08, gain: 0.05 })
            tone(go.ctx, go.now + 0.06, { type: 'triangle', freq: base * 1.5, dur: 0.12, gain: 0.05, send: 0.2 })
        },
        // Buying or equipping in the shop and the hangar.
        purchase() {
            const go = begin('purchase', 0.1)
            if (!go) return
            tone(go.ctx, go.now, { type: 'square', freq: 1318, dur: 0.07, gain: 0.04 })
            tone(go.ctx, go.now + 0.08, { type: 'square', freq: 1760, dur: 0.2, gain: 0.04, send: 0.25 })
            hiss(go.ctx, go.now, { filter: 'highpass', freq: 5000, dur: 0.08, gain: 0.05 })
        },
        click() {
            const go = begin('click', 0.03)
            if (!go) return
            tone(go.ctx, go.now, { type: 'sine', freq: 900, to: 700, dur: 0.04, gain: 0.04 })
        },
        whoosh() {
            const go = begin('whoosh', 0.2)
            if (!go) return
            hiss(go.ctx, go.now, { filter: 'bandpass', freq: 300, to: 2500, q: 1.5, dur: 0.3, gain: 0.06 })
        },

        /* The bosses. */
        bossArrive(kind) {
            const go = begin('bossArrive', 1)
            if (!go) return
            const { ctx, now } = go
            // A low brass-like horn for everyone, then each boss's own signature.
            tone(ctx, now, { type: 'sawtooth', freq: 73.4, dur: 1.4, gain: 0.08, attack: 0.15, send: 0.5 })
            tone(ctx, now, { type: 'sawtooth', freq: 110, dur: 1.4, gain: 0.06, attack: 0.15, send: 0.5 })
            hiss(ctx, now, { filter: 'lowpass', freq: 200, to: 900, dur: 1.4, gain: 0.08, attack: 0.3, send: 0.5 })
            if (kind === 'bell') api.wave('bell')
            if (kind === 'clock')
                [0.4, 0.9, 1.4].forEach(at =>
                    tone(ctx, now + at, { type: 'square', freq: 1200, dur: 0.03, gain: 0.05 })
                )
            if (kind === 'inbox') arpeggio(ctx, now + 0.5, [NOTE.E5, NOTE.C5], { gain: 0.05 })
            if (kind === 'calendar')
                hiss(ctx, now + 0.5, { filter: 'bandpass', freq: 2000, q: 3, dur: 0.25, gain: 0.08 })
        },
        // A beam charging: a rising whine, then the burn: a fat zap.
        beamWarn() {
            const go = begin('beamWarn')
            if (!go) return
            tone(go.ctx, go.now, { type: 'sine', freq: 300, to: 1400, dur: 0.95, gain: 0.04 })
        },
        beamFire() {
            const go = begin('beamFire')
            if (!go) return
            tone(go.ctx, go.now, { type: 'sawtooth', freq: 110, dur: 0.6, gain: 0.08, send: 0.3 })
            hiss(go.ctx, go.now, { filter: 'bandpass', freq: 1800, q: 0.8, dur: 0.6, gain: 0.08 })
        },
        // A shockwave: the bell's big metallic dong, or a heavy pulse for anyone else.
        wave(kind = 'bell') {
            const go = begin('wave')
            if (!go) return
            const { ctx, now } = go
            if (kind === 'bell') {
                ;[1, 2.76, 5.4].forEach((ratio, i) =>
                    tone(ctx, now, {
                        type: 'sine',
                        freq: 196 * ratio,
                        dur: 1.6 - i * 0.4,
                        gain: 0.09 / (i + 1),
                        send: 0.5,
                    })
                )
            } else tone(ctx, now, { type: 'sine', freq: 70, to: 40, dur: 0.6, gain: 0.15, send: 0.4 })
        },
        // The Grand Deadline's clockwork: tick… tock…
        tick(tock) {
            const go = begin('tick')
            if (!go) return
            tone(go.ctx, go.now, { type: 'square', freq: tock ? 900 : 1300, dur: 0.025, gain: 0.04 })
        },
        bossDown() {
            const go = begin('bossDown', 1)
            if (!go) return
            const { ctx, now } = go
            hiss(ctx, now, { filter: 'lowpass', freq: 3000, to: 60, dur: 1.6, gain: 0.25, send: 0.6 })
            tone(ctx, now, { type: 'sine', freq: 70, to: 25, dur: 1.4, gain: 0.25, send: 0.4 })
            arpeggio(ctx, now + 0.6, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], {
                step: 0.11,
                dur: 0.35,
                gain: 0.07,
                send: 0.5,
            })
        },

        /* Anna. */
        // One footstep of the run-up: a soft thud, quicker and brighter as she speeds up.
        step(speed = 0) {
            const go = begin('step')
            if (!go) return
            hiss(go.ctx, go.now, {
                filter: 'lowpass',
                freq: vary(500 + speed * 600, 0.2),
                dur: 0.05,
                gain: 0.06 + speed * 0.04,
            })
            tone(go.ctx, go.now, { type: 'sine', freq: vary(90, 0.1), to: 50, dur: 0.05, gain: 0.05 })
        },
        // The jetpack firing up for lift-off.
        ignition() {
            const go = begin('ignition', 0.5)
            if (!go) return
            const { ctx, now } = go
            hiss(ctx, now, { filter: 'lowpass', freq: 200, to: 4000, dur: 0.7, gain: 0.2, send: 0.4 })
            tone(ctx, now, { type: 'sawtooth', freq: 55, to: 110, dur: 0.8, gain: 0.08 })
            tone(ctx, now, { type: 'sine', freq: 40, dur: 0.5, gain: 0.15 })
        },
        // The jetpack in flight: a low steady rumble whose pitch follows the speed.
        engine(level) {
            if (!level || api.muted) {
                stopLoop('engine')
                return
            }
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            if (!loops.engine) {
                const gain = ctx.createGain()
                gain.gain.setValueAtTime(0.0001, now)
                const source = ctx.createBufferSource()
                source.buffer = noise
                source.loop = true
                const filter = ctx.createBiquadFilter()
                filter.type = 'lowpass'
                filter.frequency.setValueAtTime(260, now)
                const hum = ctx.createOscillator()
                hum.type = 'triangle'
                hum.frequency.setValueAtTime(48, now)
                source.connect(filter).connect(gain)
                hum.connect(gain)
                gain.connect(master)
                source.start(now)
                hum.start(now)
                loops.engine = { gain, nodes: [source, hum], filter, hum }
            }
            const loop = loops.engine
            loop.gain.gain.setTargetAtTime(0.018 + level * 0.014, now, 0.2)
            loop.filter.frequency.setTargetAtTime(220 + level * 260, now, 0.2)
            loop.hum.frequency.setTargetAtTime(44 + level * 14, now, 0.2)
        },
        greet() {
            const go = begin('greet', 0.5)
            if (!go) return
            arpeggio(go.ctx, go.now, [NOTE.G5, NOTE.C6], { type: 'sine', step: 0.1, dur: 0.18, gain: 0.07, send: 0.3 })
        },

        /* Stings. */
        missionStart() {
            const go = begin('missionStart', 1)
            if (!go) return
            arpeggio(go.ctx, go.now, [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5], { step: 0.1, dur: 0.25, gain: 0.07 })
        },
        missionComplete() {
            const go = begin('missionComplete', 1)
            if (!go) return
            const { ctx, now } = go
            arpeggio(ctx, now, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], { step: 0.12, dur: 0.3, gain: 0.07, send: 0.5 })
            ;[NOTE.C5, NOTE.E5, NOTE.G5].forEach(freq =>
                tone(ctx, now + 0.5, { type: 'triangle', freq, dur: 0.9, gain: 0.04, send: 0.5 })
            )
        },
        gameOver() {
            const go = begin('gameOver', 1)
            if (!go) return
            arpeggio(go.ctx, go.now + 0.3, [NOTE.E5, NOTE.C5, NOTE.A4, NOTE.E4], {
                type: 'sawtooth',
                step: 0.22,
                dur: 0.4,
                gain: 0.04,
                send: 0.4,
            })
        },

        /* Compatibility with older callers. */
        pew(volume = 1) {
            if (volume >= 0.5) api.weapon('bolt')
            else api.gun(1)
        },
        boom(size = 1) {
            api.explosion(size)
        },
        chime() {
            api.pickup('repair')
        },

        close() {
            Object.keys(loops).forEach(stopLoop)
            if (context && context.close) context.close().catch(() => {})
            context = null
        },
    }
    return api
}
