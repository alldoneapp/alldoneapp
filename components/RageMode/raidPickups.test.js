import { createRandom } from './rageDebris'
import { createRun, MAX_BOMBS } from './raidRun'
import {
    activeBuffs,
    collectPickup,
    createBuffs,
    DROP_CHANCE,
    DROP_COUNT,
    enemyTimeScale,
    fireIntervalFactor,
    isActive,
    pickPickup,
    PICKUP_IDS,
    PICKUP_TYPES,
    rollDrops,
    SLOWMO_SCALE,
} from './raidPickups'

const histogram = (run, rolls = 4000) => {
    const random = createRandom(7)
    const counts = Object.fromEntries(PICKUP_IDS.map(id => [id, 0]))
    for (let i = 0; i < rolls; i++) counts[pickPickup(random, run)] += 1
    return counts
}

describe('raid pickups', () => {
    it('drops every kind sometimes, and only from things that can drop', () => {
        const counts = histogram(createRun())
        PICKUP_IDS.forEach(id => expect(counts[id]).toBeGreaterThan(0))
        const random = createRandom(3)
        expect(rollDrops('nothing', random, createRun())).toEqual([])
        expect(rollDrops('carrier', random, createRun())).toHaveLength(2)
        expect(rollDrops('boss', random, createRun())).toHaveLength(DROP_COUNT.boss)
        expect(DROP_CHANCE.meeting).toBeGreaterThan(DROP_CHANCE.mail)
    })

    it('offers more repairs to a battered shield, and no bombs to a full bay', () => {
        const healthy = histogram(createRun())
        const battered = histogram(createRun({ startShield: 10 }))
        expect(battered.repair).toBeGreaterThan(healthy.repair * 2)
        const full = createRun()
        full.bombs = MAX_BOMBS
        expect(histogram(full).bomb).toBe(0)
    })

    it('applies instant pickups to the run and scores them', () => {
        const run = createRun({ startShield: 40 })
        const buffs = createBuffs()
        expect(collectPickup(buffs, run, 'repair', 0)).toEqual({ id: 'repair', instant: true })
        expect(run.shield).toBe(40 + PICKUP_TYPES.repair.amount)
        collectPickup(buffs, run, 'bomb', 0)
        collectPickup(buffs, run, 'credits', 0)
        expect(run.bombs).toBe(3)
        expect(run.credits).toBe(PICKUP_TYPES.credits.amount)
        expect(run.score).toBeGreaterThan(0)
        expect(collectPickup(buffs, run, 'nonsense', 0)).toBeNull()
    })

    it('runs timed buffs out on time, and stacks a second one up to twice as long', () => {
        const run = createRun()
        const buffs = createBuffs()
        collectPickup(buffs, run, 'coffee', 10)
        expect(isActive(buffs, 'coffee', 17.9)).toBe(true)
        expect(isActive(buffs, 'coffee', 18.1)).toBe(false)
        collectPickup(buffs, run, 'coffee', 20)
        collectPickup(buffs, run, 'coffee', 21)
        collectPickup(buffs, run, 'coffee', 22)
        expect(isActive(buffs, 'coffee', 22 + 16 - 0.1)).toBe(true)
        expect(isActive(buffs, 'coffee', 22 + 16 + 0.1)).toBe(false)
    })

    it('turns buffs into effects, and lists what is running soonest-first', () => {
        const run = createRun()
        const buffs = createBuffs()
        expect(fireIntervalFactor(buffs, 0)).toBe(1)
        expect(enemyTimeScale(buffs, 0)).toBe(1)
        collectPickup(buffs, run, 'coffee', 0)
        collectPickup(buffs, run, 'slowmo', 0)
        expect(fireIntervalFactor(buffs, 1)).toBeLessThan(1)
        expect(enemyTimeScale(buffs, 1)).toBe(SLOWMO_SCALE)
        expect(activeBuffs(buffs, 1).map(buff => buff.id)).toEqual(['slowmo', 'coffee'])
        expect(activeBuffs(buffs, 100)).toEqual([])
    })
})
