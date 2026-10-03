import { createRandom } from './rageDebris'
import {
    canFireFrom,
    createEnemy,
    damageEnemy,
    ENEMY_TYPES,
    expandWave,
    mineBurst,
    pathPoint,
    splitSpecs,
    stepAirEnemy,
    stepBullet,
    stepEnemyFire,
} from './raidEnemies'

const viewport = { width: 1200, height: 800 }
const onScreen = point => point.x >= 0 && point.x <= viewport.width && point.y >= 0 && point.y <= viewport.height

// Every pattern must start off screen, actually cross the screen, and leave it again.
const PATTERNS = [
    { pattern: 'vee', type: 'fighter', count: 5, spacing: 0, x: 0.5 },
    { pattern: 'weave', type: 'mail', count: 6, spacing: 0.3, x: 0.3 },
    { pattern: 'sweep', type: 'mail', count: 6, spacing: 0.3, y: 0.3, side: 'right' },
    { pattern: 'swoop', type: 'fighter', count: 3, spacing: 0.6, side: 'left' },
    { pattern: 'hover', type: 'fighter', count: 4, spacing: 0, y: 0.22 },
    { pattern: 'zigzag', type: 'chat', count: 4, spacing: 0.6 },
    { pattern: 'drift', type: 'mine', count: 5, spacing: 0.8 },
    { pattern: 'single', type: 'deadline', count: 1, spacing: 0, y: 0.24, hold: 9 },
    { pattern: 'sweep', type: 'carrier', count: 1, spacing: 0, y: 0.18, side: 'left', duration: 6 },
]

// Steps an enemy until it is gone (or 40 simulated seconds pass), firing at a fixed target.
const fly = (enemy, target, step = 1 / 30) => {
    const shots = []
    const random = createRandom(5)
    let alive = true
    for (let t = 0; t < 40 && alive; t += step) {
        alive = stepAirEnemy(enemy, step, target)
        shots.push(...stepEnemyFire(enemy, step, target, viewport, 1, random))
    }
    return { alive, shots }
}

describe('raid enemies', () => {
    it.each(PATTERNS)('$pattern: enters from off screen, crosses it, and leaves', wave => {
        const enemies = expandWave(wave, viewport)
        expect(enemies).toHaveLength(wave.count)
        enemies.forEach(({ path }) => {
            expect(onScreen(pathPoint(path, 0))).toBe(false)
            let seen = false
            let t = 0
            let point = pathPoint(path, 0)
            while (!point.done && t < 30) {
                t += 1 / 30
                point = pathPoint(path, t)
                if (onScreen(point)) seen = true
            }
            expect(seen).toBe(true)
            expect(point.done).toBe(true)
            expect(onScreen(point)).toBe(false)
        })
    })

    it('flies the same path every time: a wave is a plan, not dice', () => {
        const a = expandWave(PATTERNS[1], viewport).map(({ path }) => pathPoint(path, 1.7))
        const b = expandWave(PATTERNS[1], viewport).map(({ path }) => pathPoint(path, 1.7))
        expect(a).toEqual(b)
    })

    it('scales health with difficulty', () => {
        const random = createRandom(3)
        const easy = createEnemy({ type: 'fighter', path: { kind: 'dive' } }, 1, random)
        const hard = createEnemy({ type: 'fighter', path: { kind: 'dive' } }, 1.5, random)
        expect(hard.hp).toBeGreaterThan(easy.hp)
    })

    it('fires aimed shots at the ship once its timer runs out, but only from the fire zone', () => {
        const random = createRandom(1)
        const enemy = createEnemy({ type: 'fighter', path: PATTERNS[0] }, 1, random)
        enemy.x = 600
        enemy.y = 200
        const ship = { x: 600, y: 700 }
        let bullets = []
        for (let i = 0; i < 300 && !bullets.length; i++)
            bullets = stepEnemyFire(enemy, 1 / 60, ship, viewport, 1, random)
        expect(bullets).toHaveLength(1)
        expect(bullets[0].vy).toBeGreaterThan(0)
        expect(Math.abs(bullets[0].vx)).toBeLessThan(1)

        enemy.y = 760
        enemy.fireIn = 0
        expect(stepEnemyFire(enemy, 1 / 60, ship, viewport, 1, random)).toEqual([])
        expect(canFireFrom(10, viewport)).toBe(false)
    })

    it('never makes mail shoot', () => {
        const random = createRandom(1)
        const mail = createEnemy({ type: 'mail', path: PATTERNS[1] }, 2, random)
        mail.y = 300
        for (let i = 0; i < 600; i++)
            expect(stepEnemyFire(mail, 1 / 60, { x: 0, y: 700 }, viewport, 2, random)).toEqual([])
    })

    it('fans armoured fire', () => {
        const random = createRandom(2)
        const bunker = createEnemy({ type: 'armoured' }, 1, random)
        bunker.x = 300
        bunker.y = 300
        bunker.fireIn = 0
        expect(stepEnemyFire(bunker, 1 / 60, { x: 300, y: 700 }, viewport, 1, random)).toHaveLength(3)
    })

    it('moves enemies along their path and reports when they are gone', () => {
        const random = createRandom(4)
        const [spec] = expandWave(PATTERNS[2], viewport)
        const enemy = createEnemy(spec, 1, random)
        expect(stepAirEnemy(enemy, 0.5)).toBe(true)
        expect(enemy.x).toBeLessThan(viewport.width + 60)
        expect(stepAirEnemy(enemy, 10)).toBe(false)
    })

    it('kills an enemy exactly once', () => {
        const enemy = createEnemy({ type: 'mail' }, 1, createRandom(1))
        expect(damageEnemy(enemy, 5)).toBe(true)
        expect(damageEnemy(enemy, 5)).toBe(false)
    })

    it('gives every enemy kind a size, health and contact damage, and tints its fire', () => {
        Object.entries(ENEMY_TYPES)
            .filter(([, type]) => type.layer === 'air')
            .forEach(([id, type]) => {
                expect(type.hp).toBeGreaterThan(0)
                expect(type.radius).toBeGreaterThan(0)
                if (id !== 'carrier') expect(type.contact).toBeGreaterThan(0)
            })
        const random = createRandom(2)
        const chat = createEnemy({ type: 'chat', path: PATTERNS[0] }, 1, random)
        chat.x = 600
        chat.y = 200
        chat.fireIn = 0
        const shots = stepEnemyFire(chat, 1 / 60, { x: 600, y: 700 }, viewport, 1, random)
        expect(shots).toHaveLength(3)
        expect(shots.every(shot => shot.tint === ENEMY_TYPES.chat.tint)).toBe(true)
    })

    it('fires a meeting ring all the way round, turned a little every time', () => {
        const random = createRandom(3)
        const meeting = createEnemy({ type: 'meeting', path: { kind: 'hover' } }, 1, random)
        meeting.x = 600
        meeting.y = 200
        meeting.fireIn = 0
        const first = stepEnemyFire(meeting, 1 / 60, { x: 600, y: 700 }, viewport, 1, random)
        expect(first).toHaveLength(ENEMY_TYPES.meeting.fire.count)
        const up = first.filter(shot => shot.vy < 0).length
        expect(up).toBeGreaterThan(2)
        meeting.fireIn = 0
        const second = stepEnemyFire(meeting, 1 / 60, { x: 600, y: 700 }, viewport, 1, random)
        expect(second[0].vx).not.toBeCloseTo(first[0].vx)
    })

    it('makes the deadline fire spirals in bursts, with pauses in between', () => {
        const [spec] = expandWave(PATTERNS[7], viewport)
        const deadline = createEnemy(spec, 1, createRandom(4))
        const { shots } = fly(deadline, { x: 600, y: 700 })
        expect(shots.length).toBeGreaterThan(60)
        // Two streams, turning: consecutive pairs leave at different angles.
        const angle = shot => Math.atan2(shot.vy, shot.vx)
        expect(angle(shots[2])).not.toBeCloseTo(angle(shots[0]))
    })

    it('lets a ping chase Anna, but no faster than it can turn', () => {
        const [spec] = expandWave({ pattern: 'swarm', type: 'ping', count: 1, spacing: 0 }, viewport)
        const ping = createEnemy(spec, 1, createRandom(1))
        const target = { x: 100, y: 700 }
        let closest = Infinity
        for (let i = 0; i < 180; i++) {
            stepAirEnemy(ping, 1 / 60, target)
            closest = Math.min(closest, Math.hypot(ping.x - target.x, ping.y - target.y))
        }
        expect(closest).toBeLessThan(60)
        expect(fly(createEnemy(spec, 1, createRandom(1)), null).alive).toBe(false)
    })

    it('splits a sticky note into two smaller ones thrown apart, and only a note', () => {
        const note = createEnemy({ type: 'note', path: { kind: 'drift' } }, 1, createRandom(1))
        note.x = 500
        note.y = 300
        const halves = splitSpecs(note, viewport).map(spec => createEnemy(spec, 1, createRandom(1)))
        expect(halves.map(half => half.type)).toEqual(['noteSmall', 'noteSmall'])
        halves.forEach(half => stepAirEnemy(half, 0.5))
        expect(halves[0].x).toBeLessThan(500)
        expect(halves[1].x).toBeGreaterThan(500)
        expect(splitSpecs(createEnemy({ type: 'mail', path: {} }, 1, createRandom(1)), viewport)).toEqual([])
    })

    it('makes a triggered mine go off bigger than one that was shot', () => {
        const mine = createEnemy({ type: 'mine', path: { kind: 'drift' } }, 1, createRandom(1))
        expect(mineBurst(mine, true).length).toBeGreaterThan(mineBurst(mine, false).length)
    })

    it('drops bullets that leave the screen', () => {
        const bullet = { x: 10, y: 10, vx: -400, vy: 0, age: 0 }
        expect(stepBullet(bullet, 0.01, viewport)).toBe(true)
        expect(stepBullet(bullet, 1, viewport)).toBe(false)
    })
})
