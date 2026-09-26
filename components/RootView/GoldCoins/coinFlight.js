/**
 * The flight of the gold coins earned by completing a task: from the checkbox, in a small burst and
 * an arc, into the Gold counter in the top bar. Pure maths — the 3D overlay only draws what this
 * returns, so the choreography is testable without WebGL.
 */

export const COIN_STAGGER = 0.085
export const BURST_SHARE = 0.2

const clamp01 = value => Math.max(0, Math.min(1, value))
const easeOutCubic = t => 1 - (1 - t) ** 3
// Slow out of the burst, then drawn in faster and faster, as if the counter pulls the coin in.
const easeInQuad = t => t * t

/**
 * @param {{x: number, y: number}} from viewport px (the checkbox centre)
 * @param {{x: number, y: number}} to viewport px (the Gold counter icon centre)
 * @param {number} count coins earned (1-5)
 * @param {() => number} random 0..1
 */
export function planCoinFlights(from, to, count, random = Math.random) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.hypot(dx, dy) || 1
    const duration = Math.max(0.75, Math.min(1.15, 0.7 + distance / 2400))
    return Array.from({ length: Math.max(1, Math.min(8, count)) }, (_, index) => {
        // Each coin pops out of the checkbox in its own direction, mostly upwards.
        const angle = -Math.PI / 2 + (random() - 0.5) * 2.2
        const pop = 26 + random() * 20
        const burst = { x: from.x + Math.cos(angle) * pop, y: from.y + Math.sin(angle) * pop }
        // Then an arc to the counter, bowed upwards and a little to one side.
        const lift = Math.min(260, 90 + distance * 0.35)
        const sideways = (random() - 0.5) * 0.35 * distance
        const control = {
            x: (burst.x + to.x) / 2 - (dy / distance) * sideways,
            y: Math.min(burst.y, to.y) - lift + (dx / distance) * sideways * 0.2,
        }
        return {
            delay: index * COIN_STAGGER,
            duration: duration + random() * 0.08,
            from: { ...from },
            to: { ...to },
            burst,
            control,
            spin: (7 + random() * 5) * (random() < 0.5 ? -1 : 1),
            tilt: (random() - 0.5) * 0.8,
        }
    })
}

/**
 * Where a coin is `elapsed` seconds after the launch.
 *
 * @returns {{ started: boolean, landed: boolean, x: number, y: number, scale: number, spin: number }}
 *   scale is relative to the coin's resting size
 */
export function coinPositionAt(flight, elapsed) {
    const local = elapsed - flight.delay
    if (local < 0) return { started: false, landed: false, x: flight.from.x, y: flight.from.y, scale: 0, spin: 0 }
    const t = clamp01(local / flight.duration)
    if (t >= 1) return { started: true, landed: true, x: flight.to.x, y: flight.to.y, scale: 0.7, spin: 0 }
    let x
    let y
    if (t < BURST_SHARE) {
        const p = easeOutCubic(t / BURST_SHARE)
        x = flight.from.x + (flight.burst.x - flight.from.x) * p
        y = flight.from.y + (flight.burst.y - flight.from.y) * p
    } else {
        const p = easeInQuad((t - BURST_SHARE) / (1 - BURST_SHARE))
        const q = 1 - p
        x = q * q * flight.burst.x + 2 * q * p * flight.control.x + p * p * flight.to.x
        y = q * q * flight.burst.y + 2 * q * p * flight.control.y + p * p * flight.to.y
    }
    // Grows as it pops out (closer to the viewer), shrinks into the counter.
    const scale =
        t < BURST_SHARE
            ? 0.4 + 0.8 * easeOutCubic(t / BURST_SHARE)
            : 1.2 - 0.5 * ((t - BURST_SHARE) / (1 - BURST_SHARE))
    return { started: true, landed: false, x, y, scale, spin: local * flight.spin }
}
