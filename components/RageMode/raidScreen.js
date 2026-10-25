/**
 * How much raid fits on this screen. A phone shows about a third of the play area a laptop does,
 * with the same Anna and the same hit box — so the same waves would be three times as dense there,
 * and far harder. Everything that fills the screen is scaled by its AREA against a reference laptop
 * screen (1280×800):
 *
 *   density  how many: enemies per wave, bullets per ring, bunkers along the route, armed rows at
 *            take-off. The square root of the area ratio, so it follows the screen's size rather
 *            than overreacting to it; slightly above 1 on big screens, so they do not feel empty.
 *   pace     how often: enemy, bunker and boss fire. Gentler than density (a phone keeps about two
 *            thirds of the rate), because fewer enemies already means fewer bullets.
 *
 * Health, damage and scoring do not change: a mission is as long and a boss as tough everywhere.
 */

export const REFERENCE_AREA = 1280 * 800
export const DENSITY_RANGE = [0.5, 1.15]
export const PACE_RANGE = [0.65, 1]

const clamp = (value, [min, max]) => Math.max(min, Math.min(max, value))

export const screenFactors = viewport => {
    const ratio = Math.max(0.01, (viewport.width * viewport.height) / REFERENCE_AREA)
    return {
        density: clamp(Math.sqrt(ratio), DENSITY_RANGE),
        pace: clamp(Math.pow(ratio, 0.35), PACE_RANGE),
    }
}

/** `count` things on this screen: never fewer than one. */
export const scaleCount = (count, density = 1) => Math.max(1, Math.round(count * density))

export const FULL_SCREEN = { density: 1, pace: 1 }
