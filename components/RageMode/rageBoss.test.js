import { createRandom } from './rageDebris'
import {
    BOSS_AFTER_SECONDS,
    BOSS_AFTER_SNAKES,
    BOSS_HP_PER_TASK,
    BOSS_MIN_HP,
    bossMaxHp,
    createBoss,
    damageBoss,
    displayedCount,
    insideBoss,
    shouldSummonBoss,
    stepBoss,
    stepOrb,
} from './rageBoss'
import {
    applyDamage,
    bossKillPoints,
    createHealth,
    DAMAGE,
    heal,
    INVULNERABLE_SECONDS,
    isBlinking,
    MAX_HEALTH,
    POINTS,
    pointsForHit,
} from './rageCombat'

const viewport = { width: 1280, height: 800 }
const hero = { x: 300, y: 600 }

const settle = boss => {
    const random = createRandom(3)
    for (let i = 0; i < 240 && boss.phase === 'entering'; i++) stepBoss(boss, 1 / 60, hero, viewport, random)
}

describe('the boss', () => {
    it('is built from today’s open-task count', () => {
        expect(bossMaxHp(10)).toBe(10 * BOSS_HP_PER_TASK)
        expect(bossMaxHp(1)).toBe(BOSS_MIN_HP)
        const boss = createBoss(12, viewport)
        expect(displayedCount(boss)).toBe(12)
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

    it('turns up after enough snakes or enough time, once, and never on an empty day', () => {
        expect(shouldSummonBoss({ snakesKilled: BOSS_AFTER_SNAKES, elapsed: 0, summoned: false, openTasks: 5 })).toBe(
            true
        )
        expect(shouldSummonBoss({ snakesKilled: 0, elapsed: BOSS_AFTER_SECONDS, summoned: false, openTasks: 5 })).toBe(
            true
        )
        expect(shouldSummonBoss({ snakesKilled: 1, elapsed: 10, summoned: false, openTasks: 5 })).toBe(false)
        expect(shouldSummonBoss({ snakesKilled: 9, elapsed: 99, summoned: true, openTasks: 5 })).toBe(false)
        expect(shouldSummonBoss({ snakesKilled: 9, elapsed: 99, summoned: false, openTasks: 0 })).toBe(false)
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

    it('expires orbs that leave the screen', () => {
        const orb = { x: 10, y: 10, vx: -400, vy: 0, age: 0 }
        expect(stepOrb(orb, 0.2, viewport)).toBe(false)
    })

    it('knows what is inside it', () => {
        const boss = createBoss(4, viewport)
        boss.x = 500
        boss.y = 300
        expect(insideBoss(boss, 500, 300)).toBe(true)
        expect(insideBoss(boss, 900, 300)).toBe(false)
    })
})

describe('health and score', () => {
    it('takes damage, then blinks and cannot be hit again for a moment', () => {
        const health = createHealth()
        expect(applyDamage(health, DAMAGE.snakeBite, 1)).toEqual({ hit: true, dead: false })
        expect(health.hp).toBe(MAX_HEALTH - DAMAGE.snakeBite)
        expect(isBlinking(health, 1.5)).toBe(true)
        expect(applyDamage(health, DAMAGE.snakeBite, 1.5).hit).toBe(false)
        expect(applyDamage(health, DAMAGE.snakeBite, 1 + INVULNERABLE_SECONDS).hit).toBe(true)
    })

    it('ends the game at zero, never below', () => {
        const health = createHealth()
        let now = 0
        let result
        do {
            result = applyDamage(health, DAMAGE.bossContact, now)
            now += INVULNERABLE_SECONDS
        } while (!result.dead)
        expect(health.hp).toBe(0)
        expect(applyDamage(health, 5, now + 10)).toEqual({ hit: false, dead: true })
    })

    it('heals up to the maximum, but not from zero', () => {
        const health = createHealth()
        applyDamage(health, 30, 0)
        heal(health, 50)
        expect(health.hp).toBe(MAX_HEALTH)
        health.hp = 0
        heal(health, 50)
        expect(health.hp).toBe(0)
    })

    it('scores letters, images and blocks, and a boss by its task count', () => {
        expect(pointsForHit({ kind: 'text', glyphs: [1, 2, 3] })).toBe(3 * POINTS.letter)
        expect(pointsForHit({ kind: 'image' })).toBe(POINTS.image)
        expect(pointsForHit({ kind: 'box' })).toBe(POINTS.block)
        expect(bossKillPoints(12)).toBe(POINTS.bossKill + 12 * POINTS.bossPerTask)
    })
})
