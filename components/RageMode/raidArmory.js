/**
 * What Anna fires in the raid. Pure: the arena asks for a volley and gets back where each projectile
 * leaves from and in which direction. Angles are radians in SCREEN space, so straight up the
 * screen is -π/2.
 *
 * Two layers, as in the classic vertical shooters:
 *   - the MAIN GUN, always firing, upgraded with credits in the hangar (`cannonLevel` 1–3);
 *   - one SPECIAL weapon on top, chosen from the ones bought with Gold (`rageWeapons.js`). The
 *     blaster is the "no special" choice.
 */

export const UP = -Math.PI / 2
export const MAIN_GUN_SPEED = 1150
export const MAIN_GUN_DAMAGE = 1

const LEVELS = {
    1: {
        interval: 0.15,
        barrels: [
            { dx: -9, angle: UP },
            { dx: 9, angle: UP },
        ],
    },
    2: {
        interval: 0.14,
        barrels: [
            { dx: -9, angle: UP },
            { dx: 9, angle: UP },
            { dx: -16, angle: UP - 0.14 },
            { dx: 16, angle: UP + 0.14 },
        ],
    },
    3: {
        interval: 0.11,
        barrels: [
            { dx: 0, angle: UP },
            { dx: -10, angle: UP },
            { dx: 10, angle: UP },
            { dx: -18, angle: UP - 0.16 },
            { dx: 18, angle: UP + 0.16 },
        ],
    },
}

export const mainGun = level => LEVELS[Math.max(1, Math.min(3, level | 0))] || LEVELS[1]

/** The angles a special volley leaves at: `pellets` of them fanned evenly around straight up. */
export const specialAngles = weapon => {
    const pellets = weapon.pellets || 1
    if (pellets === 1) return [UP]
    const spread = weapon.spread || 0
    return Array.from({ length: pellets }, (_, i) => UP - spread / 2 + (spread * i) / (pellets - 1))
}

/**
 * Turn a homing rocket towards `target` by at most `rate·dt` radians. Returns the new angle.
 * Without a target it keeps flying straight.
 */
export const steerTowards = (angle, from, target, rate, dt) => {
    if (!target) return angle
    const wanted = Math.atan2(target.y - from.y, target.x - from.x)
    let delta = wanted - angle
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const max = rate * dt
    return angle + Math.max(-max, Math.min(max, delta))
}

/** The nearest of `targets` ({x, y}) to `from` that is in front of (above) it, or null. */
export const nearestAhead = (from, targets) => {
    let best = null
    let bestDistance = Infinity
    targets.forEach(target => {
        if (target.y > from.y + 40) return
        const distance = Math.hypot(target.x - from.x, target.y - from.y)
        if (distance < bestDistance) {
            best = target
            bestDistance = distance
        }
    })
    return best
}
