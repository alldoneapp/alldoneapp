import { createRandom } from './rageDebris'
import { createEnemy, expandWave, stepEnemyFire } from './raidEnemies'
import { createRaidBoss, stepRaidBoss } from './raidBosses'
import { buildMission } from './raidLevel'
import { DENSITY_RANGE, scaleCount, screenFactors } from './raidScreen'

const laptop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }
const big = { width: 2560, height: 1440 }

// Shots a shooter fires in `seconds` on a given screen.
const shotsIn = (type, screen, seconds = 30) => {
    const random = createRandom(3)
    const enemy = createEnemy({ type, path: { kind: 'hover' } }, 1, random)
    enemy.x = 200
    enemy.y = 200
    let shots = 0
    for (let t = 0; t < seconds; t += 1 / 30)
        shots += stepEnemyFire(enemy, 1 / 30, { x: 200, y: 700 }, phone, 1, random, screen).length
    return shots
}

describe('raid screen scaling', () => {
    it('is the reference on a laptop, sparser on a phone, a little fuller on a big screen', () => {
        expect(screenFactors(laptop)).toEqual({ density: 1, pace: 1 })
        const small = screenFactors(phone)
        expect(small.density).toBeGreaterThanOrEqual(DENSITY_RANGE[0])
        expect(small.density).toBeLessThan(0.65)
        expect(small.pace).toBeLessThan(0.75)
        expect(screenFactors(big).density).toBeGreaterThan(1)
        expect(screenFactors(big).pace).toBe(1)
        expect(scaleCount(1, 0.5)).toBe(1)
    })

    it('sends smaller waves on a phone', () => {
        const wave = { pattern: 'weave', type: 'mail', count: 7, spacing: 0.3, x: 0.5 }
        expect(expandWave(wave, laptop)).toHaveLength(7)
        expect(expandWave(wave, phone, screenFactors(phone).density)).toHaveLength(4)
        const single = { pattern: 'single', type: 'deadline', count: 1, spacing: 0 }
        expect(expandWave(single, phone, screenFactors(phone).density)).toHaveLength(1)
    })

    it('makes enemies fire less often, and meetings fire smaller rings, on a phone', () => {
        const small = screenFactors(phone)
        expect(shotsIn('fighter', small)).toBeLessThan(shotsIn('fighter', screenFactors(laptop)) * 0.8)
        expect(shotsIn('meeting', small)).toBeLessThan(shotsIn('meeting', screenFactors(laptop)) * 0.7)
    })

    it('slows every boss down on a phone, but leaves its health alone', () => {
        const fight = screen => {
            const boss = createRaidBoss('calendar', 3, phone)
            const random = createRandom(5)
            let orbs = 0
            for (let t = 0; t < 30; t += 1 / 30)
                orbs += stepRaidBoss(boss, 1 / 30, { x: 195, y: 700 }, phone, random, screen).orbs.length
            return { orbs, hp: boss.maxHp }
        }
        const small = fight(screenFactors(phone))
        const full = fight(screenFactors(laptop))
        expect(small.orbs).toBeLessThan(full.orbs * 0.75)
        expect(small.hp).toBe(full.hp)
    })

    it('digs in fewer bunkers along the route on a phone', () => {
        const tasks = Array.from({ length: 30 }, (_, i) => ({ label: `Task ${i}` }))
        const full = buildMission({ seed: 4, tasks, width: 1280 }).bunkers.length
        const small = buildMission({ seed: 4, tasks, width: 390, density: screenFactors(phone).density }).bunkers.length
        expect(small).toBeLessThan(full)
        expect(small).toBeGreaterThan(0)
    })
})
