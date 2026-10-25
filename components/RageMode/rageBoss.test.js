import { createRandom } from './rageDebris'
import { BOSS_HP, createBoss, damageBoss, displayedCount, insideBoss, stepBoss } from './rageBoss'

const viewport = { width: 1280, height: 800 }
const hero = { x: 300, y: 600 }

const settle = boss => {
    const random = createRandom(3)
    for (let i = 0; i < 240 && boss.phase === 'entering'; i++) stepBoss(boss, 1 / 60, hero, viewport, random)
}

describe('the boss', () => {
    it('is equally hard every day, and only wears the open-task count on its chest', () => {
        expect(createBoss(40, viewport).maxHp).toBe(BOSS_HP)
        expect(createBoss(1, viewport).maxHp).toBe(BOSS_HP)
        expect(displayedCount(createBoss(12, viewport))).toBe(12)
    })

    it('still comes on an empty inbox, showing 0 the whole fight', () => {
        const boss = createBoss(0, viewport)
        expect(boss.maxHp).toBe(BOSS_HP)
        expect(displayedCount(boss)).toBe(0)
        damageBoss(boss, BOSS_HP / 2)
        expect(displayedCount(boss)).toBe(0)
    })

    it('counts its number down as it takes damage, and hits 0 only when dead', () => {
        const boss = createBoss(10, viewport)
        damageBoss(boss, boss.maxHp / 2)
        expect(displayedCount(boss)).toBe(5)
        damageBoss(boss, boss.maxHp / 2 - 1)
        expect(displayedCount(boss)).toBe(1)
        expect(damageBoss(boss, 5)).toBe(true)
        expect(displayedCount(boss)).toBe(0)
        expect(damageBoss(boss, 5)).toBe(false)
    })

    it('flies in from above the screen and settles over the page', () => {
        const boss = createBoss(8, viewport)
        expect(boss.y).toBeLessThan(0)
        settle(boss)
        expect(boss.phase).toBe('hovering')
        expect(boss.y).toBeGreaterThan(0)
        expect(boss.y).toBeLessThan(viewport.height / 2)
    })

    it('throws orbs at Anna', () => {
        const boss = createBoss(8, viewport)
        settle(boss)
        const random = createRandom(5)
        let orbs = []
        for (let i = 0; i < 400 && !orbs.length; i++) orbs = stepBoss(boss, 1 / 60, hero, viewport, random)
        expect(orbs.length).toBe(3)
        const middle = orbs[1]
        const towards = Math.atan2(hero.y - boss.y, hero.x - boss.x)
        expect(Math.atan2(middle.vy, middle.vx)).toBeCloseTo(towards, 1)
    })

    it('throws more when it is below half health', () => {
        const boss = createBoss(8, viewport)
        settle(boss)
        damageBoss(boss, boss.maxHp * 0.6)
        const random = createRandom(5)
        let orbs = []
        for (let i = 0; i < 400 && !orbs.length; i++) orbs = stepBoss(boss, 1 / 60, hero, viewport, random)
        expect(orbs.length).toBe(5)
    })

    it('knows what is inside it', () => {
        const boss = createBoss(4, viewport)
        boss.x = 500
        boss.y = 300
        expect(insideBoss(boss, 500, 300)).toBe(true)
        expect(insideBoss(boss, 900, 300)).toBe(false)
    })
})
