import { createRandom } from './rageDebris'
import {
    BEAM_ACTIVE,
    BEAM_WARN,
    beamHits,
    BOSS_ORDER,
    bossKindFor,
    createBeam,
    createRaidBoss,
    createWave,
    damageRaidBoss,
    displayedCount,
    insideRaidBoss,
    isEnraged,
    stepBeam,
    stepRaidBoss,
    stepWave,
    WAVE_GAP,
    waveHits,
} from './raidBosses'
import { BOSS_HP } from './rageBoss'

const viewport = { width: 1280, height: 800 }
const anna = { x: 640, y: 680 }

// Fight a boss for `seconds`, collecting everything it unleashes.
const fight = (boss, seconds) => {
    const random = createRandom(9)
    const all = { orbs: [], beams: [], waves: [], spawns: [] }
    for (let t = 0; t < seconds; t += 1 / 30) {
        const out = stepRaidBoss(boss, 1 / 30, anna, viewport, random)
        Object.keys(all).forEach(key => all[key].push(...out[key]))
    }
    return all
}

describe('raid bosses', () => {
    it('sends the five bosses in turn, mission after mission', () => {
        expect([1, 2, 3, 4, 5, 6].map(bossKindFor)).toEqual([...BOSS_ORDER, BOSS_ORDER[0]])
        expect(new Set(BOSS_ORDER).size).toBe(5)
    })

    it.each(BOSS_ORDER)('%s: same strength every day, wearing the open-task count', kind => {
        const busy = createRaidBoss(kind, 14, viewport)
        const empty = createRaidBoss(kind, 0, viewport)
        expect(busy.maxHp).toBe(BOSS_HP)
        expect(empty.maxHp).toBe(BOSS_HP)
        expect(displayedCount(busy)).toBe(14)
        expect(displayedCount(empty)).toBe(0)
        damageRaidBoss(busy, BOSS_HP / 2)
        expect(displayedCount(busy)).toBe(7)
        expect(isEnraged(busy)).toBe(false)
        damageRaidBoss(busy, 1)
        expect(isEnraged(busy)).toBe(true)
    })

    it.each(BOSS_ORDER)('%s: flies in from above and settles where it can be shot', kind => {
        const boss = createRaidBoss(kind, 3, viewport)
        expect(boss.y).toBeLessThan(0)
        fight(boss, 3)
        expect(boss.phase).toBe('fighting')
        expect(boss.y - boss.halfHeight).toBeGreaterThan(0)
        expect(insideRaidBoss(boss, boss.x, boss.y)).toBe(true)
    })

    it('gives every boss its own fight', () => {
        const signature = kind => {
            const all = fight(createRaidBoss(kind, 3, viewport), 14)
            return {
                orbs: all.orbs.length > 0,
                beams: all.beams.length > 0,
                waves: all.waves.length > 0,
                spawns: all.spawns.length > 0,
            }
        }
        expect(signature('inbox')).toMatchObject({ orbs: true, spawns: true, beams: false, waves: false })
        expect(signature('calendar')).toMatchObject({ orbs: true, beams: true, waves: false })
        expect(signature('bell')).toMatchObject({ waves: true, spawns: true, beams: false })
        expect(signature('clock')).toMatchObject({ orbs: true, beams: true, waves: false })
        expect(signature('backlog')).toMatchObject({ orbs: true, beams: false, waves: false })
    })

    it('rains letters with gaps you can fly through', () => {
        const all = fight(createRaidBoss('inbox', 3, viewport), 6)
        const rows = new Map()
        all.orbs.forEach(shot => {
            if (Math.abs(shot.vx) > 1e-6) return
            const key = Math.round(shot.y)
            rows.set(key, [...(rows.get(key) || []), shot.x])
        })
        const [row] = [...rows.values()].filter(xs => xs.length > 5)
        const sorted = [...row].sort((a, b) => a - b)
        const widest = Math.max(...sorted.slice(1).map((x, i) => x - sorted[i]))
        expect(widest).toBeGreaterThan(90)
    })

    it('keeps one booked column on Anna, and gets angrier below half health', () => {
        const calm = fight(createRaidBoss('calendar', 3, viewport), 6)
        expect(calm.beams.some(beam => beam.x === anna.x)).toBe(true)
        const angry = createRaidBoss('calendar', 3, viewport)
        angry.hp = angry.maxHp * 0.3
        const furious = fight(angry, 6)
        expect(furious.beams.length).toBeGreaterThan(calm.beams.length)
    })

    it('makes the Backlog lunge at Anna now and then', () => {
        const boss = createRaidBoss('backlog', 3, viewport)
        let lowest = 0
        const random = createRandom(4)
        for (let t = 0; t < 14; t += 1 / 30) {
            stepRaidBoss(boss, 1 / 30, anna, viewport, random)
            lowest = Math.max(lowest, boss.y)
        }
        expect(lowest).toBeGreaterThan(viewport.height * 0.5)
    })

    describe('hazards', () => {
        const boss = createRaidBoss('clock', 3, viewport)
        boss.x = 640
        boss.y = 200

        it('warns before a beam can hurt, then burns, then is gone', () => {
            const column = createBeam({ kind: 'column', x: 640 }, boss)
            expect(stepBeam(column, BEAM_WARN / 2, boss)).toBe(true)
            expect(beamHits(column, 640, 680, 11)).toBe(false)
            stepBeam(column, BEAM_WARN / 2 + 0.05, boss)
            expect(beamHits(column, 640, 680, 11)).toBe(true)
            expect(beamHits(column, 760, 680, 11)).toBe(false)
            expect(stepBeam(column, BEAM_ACTIVE, boss)).toBe(false)
        })

        it('sweeps a beam round the boss, burning only along its line', () => {
            const sweep = createBeam({ kind: 'sweep', from: Math.PI / 2, to: Math.PI / 2 }, boss)
            stepBeam(sweep, BEAM_WARN + 0.1, boss)
            expect(beamHits(sweep, 640, 600, 11)).toBe(true)
            expect(beamHits(sweep, 900, 600, 11)).toBe(false)
            // Never behind the boss.
            expect(beamHits(sweep, 640, 50, 11)).toBe(false)
        })

        it('lets Anna through the gap of a shockwave, and nowhere else', () => {
            const wave = createWave({ gapAngle: Math.PI / 2 }, boss)
            while (wave.radius < 480) stepWave(wave, 1 / 30, viewport)
            const at = angle => ({
                x: wave.x + Math.cos(angle) * wave.radius,
                y: wave.y + Math.sin(angle) * wave.radius,
            })
            const gap = at(Math.PI / 2)
            const wall = at(Math.PI / 2 + WAVE_GAP)
            expect(waveHits(wave, gap.x, gap.y, 11)).toBe(false)
            expect(waveHits(wave, wall.x, wall.y, 11)).toBe(true)
            expect(waveHits(wave, wave.x, wave.y + wave.radius - 80, 11)).toBe(false)
            while (stepWave(wave, 1 / 30, viewport));
            expect(wave.radius).toBeGreaterThan(viewport.width)
        })
    })
})
