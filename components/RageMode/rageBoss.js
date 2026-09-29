/**
 * The boss: today's open tasks, as one big angry block with the number on its chest. Its health is
 * built from that count and the number counts down as it takes damage, so beating it reads as
 * "12 … 7 … 3 … 0". It hovers over the page, throws task-coloured orbs at Anna and every so often
 * charges at her.
 *
 * Pure: position, health and attacks. The arena draws it and resolves collisions.
 */

export const BOSS_HALF_WIDTH = 78
export const BOSS_HALF_HEIGHT = 66
export const BOSS_HP_PER_TASK = 12
export const BOSS_MIN_HP = 36
export const ORB_SPEED = 290
export const ORB_RADIUS = 11
export const ORB_LIFE = 5
// When it turns up: after this many snakes, or after this many seconds, whichever comes first.
export const BOSS_AFTER_SNAKES = 3
export const BOSS_AFTER_SECONDS = 45

export const bossMaxHp = openTasks => Math.max(BOSS_MIN_HP, Math.round((openTasks || 0) * BOSS_HP_PER_TASK))

export const shouldSummonBoss = ({ snakesKilled, elapsed, summoned, openTasks }) =>
    !summoned && openTasks > 0 && (snakesKilled >= BOSS_AFTER_SNAKES || elapsed >= BOSS_AFTER_SECONDS)

export const createBoss = (openTasks, viewport) => ({
    openTasks,
    hp: bossMaxHp(openTasks),
    maxHp: bossMaxHp(openTasks),
    x: viewport.width / 2,
    y: -BOSS_HALF_HEIGHT * 2,
    t: 0,
    phase: 'entering',
    attackIn: 2.2,
    chargeIn: 8,
    charge: null,
    hurt: 0,
})

/** The number on its chest: the open-task count, scaled down with its health. Never 0 while alive. */
export const displayedCount = boss =>
    boss.hp <= 0 ? 0 : Math.max(1, Math.ceil((boss.hp / boss.maxHp) * boss.openTasks))

const hoverPoint = (boss, viewport) => ({
    x: viewport.width / 2 + Math.sin(boss.t * 0.55) * viewport.width * 0.3,
    y: Math.max(BOSS_HALF_HEIGHT + 80, viewport.height * 0.28) + Math.sin(boss.t * 1.3) * 36,
})

/**
 * Advance the boss by `dt`. Returns the orbs it throws this step: `{x, y, vx, vy}` each, aimed at
 * `hero` with a small fan.
 */
export const stepBoss = (boss, dt, hero, viewport, random) => {
    boss.t += dt
    boss.hurt = Math.max(0, boss.hurt - dt)
    const orbs = []
    if (boss.hp <= 0) return orbs

    if (boss.phase === 'entering') {
        const target = hoverPoint(boss, viewport)
        boss.y += (target.y - boss.y) * Math.min(1, dt * 2.2)
        boss.x += (target.x - boss.x) * Math.min(1, dt * 2.2)
        if (Math.abs(boss.y - target.y) < 4) boss.phase = 'hovering'
        return orbs
    }

    if (boss.charge) {
        // A charge: a quick lunge at where Anna WAS, then back up to its hover line.
        boss.charge.t += dt
        const k = boss.charge.t / boss.charge.duration
        const out = k < 0.5 ? k * 2 : 2 - k * 2
        const eased = out * out * (3 - 2 * out)
        boss.x = boss.charge.from.x + (boss.charge.to.x - boss.charge.from.x) * eased
        boss.y = boss.charge.from.y + (boss.charge.to.y - boss.charge.from.y) * eased
        if (k >= 1) boss.charge = null
        return orbs
    }

    const target = hoverPoint(boss, viewport)
    boss.x += (target.x - boss.x) * Math.min(1, dt * 3)
    boss.y += (target.y - boss.y) * Math.min(1, dt * 3)

    // It gets angrier as it weakens: attacks come faster below half health.
    const fury = boss.hp < boss.maxHp / 2 ? 0.65 : 1
    boss.attackIn -= dt
    if (boss.attackIn <= 0) {
        boss.attackIn = (1.6 + random() * 1.1) * fury
        const angle = Math.atan2(hero.y - boss.y, hero.x - boss.x)
        const count = boss.hp < boss.maxHp / 2 ? 5 : 3
        for (let i = 0; i < count; i++) {
            const a = angle + (i - (count - 1) / 2) * 0.22
            orbs.push({
                x: boss.x + Math.cos(a) * BOSS_HALF_WIDTH * 0.7,
                y: boss.y + Math.sin(a) * BOSS_HALF_HEIGHT * 0.7,
                vx: Math.cos(a) * ORB_SPEED,
                vy: Math.sin(a) * ORB_SPEED,
                age: 0,
            })
        }
    }
    boss.chargeIn -= dt
    if (boss.chargeIn <= 0) {
        boss.chargeIn = (7 + random() * 4) * fury
        boss.charge = { t: 0, duration: 1.1, from: { x: boss.x, y: boss.y }, to: { x: hero.x, y: hero.y } }
    }
    return orbs
}

/** Move an orb on; returns false once it has expired or left the screen. */
export const stepOrb = (orb, dt, viewport) => {
    orb.age += dt
    orb.x += orb.vx * dt
    orb.y += orb.vy * dt
    return (
        orb.age < ORB_LIFE && orb.x > -40 && orb.y > -40 && orb.x < viewport.width + 40 && orb.y < viewport.height + 40
    )
}

export const insideBoss = (boss, x, y, pad = 0) =>
    boss.hp > 0 && Math.abs(x - boss.x) <= BOSS_HALF_WIDTH + pad && Math.abs(y - boss.y) <= BOSS_HALF_HEIGHT + pad

/** Damage the boss; returns whether that killed it. */
export const damageBoss = (boss, amount) => {
    if (boss.hp <= 0) return false
    boss.hp = Math.max(0, boss.hp - amount)
    boss.hurt = 0.12
    return boss.hp <= 0
}
