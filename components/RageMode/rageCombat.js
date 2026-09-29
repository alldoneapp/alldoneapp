/**
 * Rage mode's rules of engagement: what everything is worth, and how much Anna can take.
 * Pure — the arena reports events, this decides the numbers.
 */

export const POINTS = {
    letter: 1,
    block: 5,
    image: 10,
    snakeTile: 5,
    snakeKill: 50,
    bossHit: 2,
    bossKill: 500,
    // On top of bossKill, per open task the boss was built from: a busier day is a bigger win.
    bossPerTask: 25,
}

export const MAX_HEALTH = 100
// After a hit she blinks and cannot be hit again for a moment, so one snake cannot chew through
// her health in a single pass.
export const INVULNERABLE_SECONDS = 1.1
export const DAMAGE = { snakeBite: 10, bossOrb: 12, bossContact: 20 }
// Killing a snake patches her up a little: the way to survive is to keep fighting.
export const SNAKE_KILL_HEAL = 8

export const createHealth = () => ({ hp: MAX_HEALTH, invulnerableUntil: 0 })

/**
 * Apply `amount` damage at time `now` (seconds). Returns whether it landed and whether it was fatal;
 * a hit during the invulnerable window does nothing.
 */
export const applyDamage = (health, amount, now) => {
    if (health.hp <= 0 || now < health.invulnerableUntil) return { hit: false, dead: health.hp <= 0 }
    health.hp = Math.max(0, health.hp - amount)
    health.invulnerableUntil = now + INVULNERABLE_SECONDS
    return { hit: true, dead: health.hp <= 0 }
}

export const heal = (health, amount) => {
    if (health.hp <= 0) return health
    health.hp = Math.min(MAX_HEALTH, health.hp + amount)
    return health
}

/** True while she should blink (invulnerable after a hit). */
export const isBlinking = (health, now) => now < health.invulnerableUntil

/** Points for knocking something off the page. */
export const pointsForHit = hit => {
    if (!hit) return 0
    if (hit.kind === 'text') return (hit.glyphs ? hit.glyphs.length : 1) * POINTS.letter
    if (hit.kind === 'image') return POINTS.image
    return POINTS.block
}

export const bossKillPoints = openTasks => POINTS.bossKill + POINTS.bossPerTask * Math.max(0, openTasks || 0)
