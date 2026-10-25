import { createSound, RATE_LIMITS } from './rageSound'

// A minimal Web Audio stand-in that records what was started and stopped.
const fakeAudio = () => {
    const log = { started: 0, stopped: 0, contexts: 0 }
    const param = () => ({
        value: 1,
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
        setTargetAtTime: jest.fn(),
        cancelScheduledValues: jest.fn(),
    })
    const node = extra => ({
        connect(next) {
            return next
        },
        start: () => (log.started += 1),
        stop: () => (log.stopped += 1),
        ...extra,
    })
    class FakeContext {
        constructor() {
            log.contexts += 1
            this.currentTime = 0
            this.sampleRate = 8000
            this.state = 'running'
            this.destination = node()
        }
        createBuffer(channels, length) {
            return { getChannelData: () => new Float32Array(length) }
        }
        createGain() {
            return node({ gain: param() })
        }
        createOscillator() {
            return node({ type: 'sine', frequency: param() })
        }
        createBufferSource() {
            return node({ buffer: null, loop: false, playbackRate: param() })
        }
        createBiquadFilter() {
            return node({ type: 'lowpass', frequency: param(), Q: param() })
        }
        createConvolver() {
            return node({ buffer: null })
        }
        createDynamicsCompressor() {
            return node({ threshold: param(), ratio: param(), attack: param(), release: param() })
        }
        resume() {
            return Promise.resolve()
        }
        close() {
            return Promise.resolve()
        }
    }
    return { FakeContext, log }
}

describe('rage mode sound', () => {
    let audio
    beforeEach(() => {
        audio = fakeAudio()
        window.AudioContext = audio.FakeContext
        localStorage.clear()
    })
    afterEach(() => {
        delete window.AudioContext
    })

    it('plays every voice without throwing', () => {
        const sound = createSound()
        sound.gun(2)
        ;['bolt', 'rocket', 'flame', 'blackhole', 'implode', 'snap'].forEach(kind => sound.weapon(kind))
        sound.explosion(0.6)
        sound.explosion(2.4)
        sound.hit()
        sound.hurt()
        sound.alarm()
        sound.bomb()
        ;['chat', 'meeting', 'deadline', 'boss', 'fighter'].forEach(kind => sound.enemyShot(kind))
        sound.mine()
        sound.announce()
        ;['coffee', 'bomb', 'credits', 'star', 'shield'].forEach(id => sound.pickup(id))
        sound.combo(2)
        sound.purchase()
        sound.click()
        sound.whoosh()
        ;['backlog', 'inbox', 'calendar', 'bell', 'clock'].forEach(kind => sound.bossArrive(kind))
        sound.beamWarn()
        sound.beamFire()
        sound.wave('bell')
        sound.tick(true)
        sound.bossDown()
        sound.step(0.5)
        sound.ignition()
        sound.greet()
        sound.missionStart()
        sound.missionComplete()
        sound.gameOver()
        expect(audio.log.contexts).toBe(1)
        expect(audio.log.started).toBeGreaterThan(40)
    })

    it('rate-limits rapid fire, so auto-fire is not a wall of noise', () => {
        const sound = createSound()
        sound.gun()
        const after = audio.log.started
        sound.gun()
        sound.gun()
        expect(audio.log.started).toBe(after)
        expect(RATE_LIMITS.gun).toBeGreaterThan(0)
    })

    it('starts the engine and the laser hum once, and stops them on mute and close', () => {
        const sound = createSound()
        sound.engine(0.5)
        const started = audio.log.started
        sound.engine(0.8)
        sound.laser(true)
        sound.laser(true)
        expect(audio.log.started).toBe(started + 2)
        sound.setMuted(true)
        expect(audio.log.stopped).toBeGreaterThanOrEqual(4)
        sound.gun()
        expect(audio.log.started).toBe(started + 2)
        sound.setMuted(false)
        sound.engine(0.5)
        sound.close()
        expect(audio.log.stopped).toBeGreaterThanOrEqual(6)
    })

    it('is silent and harmless without Web Audio', () => {
        delete window.AudioContext
        const sound = createSound()
        expect(() => {
            sound.gun()
            sound.engine(1)
            sound.laser(true)
            sound.bossArrive('bell')
            sound.close()
        }).not.toThrow()
    })
})
