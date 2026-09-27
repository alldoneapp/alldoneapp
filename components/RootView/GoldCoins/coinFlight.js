/**
 * The flight of the gold coins earned by completing a task: from the checkbox into the Gold counter
 * in the top bar. There are ten choreographies (`COIN_STYLES`), one picked at random each time, so a
 * reward someone sees dozens of times a day keeps a little surprise. They differ in how the coins
 * leave the task; every one of them ends exactly on the counter, which is the promise the counter's
 * coin-by-coin count relies on. Pure maths — the 3D overlay only draws what this returns, so every
 * choreography is testable without WebGL.
 */

export const COIN_STAGGER = 0.085

const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = t => 1 - (1 - t) ** 3
const easeInQuad = t => t * t
const easeInCubic = t => t * t * t
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2
const bezier = (a, c, b, t) => {
    const q = 1 - t
    return { x: q * q * a.x + 2 * q * t * c.x + t * t * b.x, y: q * q * a.y + 2 * q * t * c.y + t * t * b.y }
}
// An arc bowed upwards between two points.
const arcControl = (a, b, lift, sideways = 0) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    return {
        x: (a.x + b.x) / 2 - (dy / length) * sideways,
        y: Math.min(a.y, b.y) - lift + (dx / length) * sideways * 0.2,
    }
}
// Every coin grows as it leaves the task (closer to the viewer) and shrinks into the counter.
const scaleFor = (s, duration) => {
    const t = s / duration
    if (t < 0.15) return 0.4 + 0.8 * easeOutCubic(t / 0.15)
    return 1.2 - 0.5 * ((t - 0.15) / 0.85)
}

/**
 * Each style returns one coin's flight: `delay` (s) before it starts, `duration` (s) of the flight,
 * and `path(s)` → `{x, y}` for `s` in [0, duration). `ctx` = { from, to, index, count, random,
 * distance }.
 */
export const COIN_STYLES = {
    // Pops out of the checkbox, then swings into the counter along an arc.
    arc: ({ from, to, index, random, distance }) => {
        const angle = -Math.PI / 2 + (random() - 0.5) * 2.2
        const pop = 26 + random() * 20
        const burst = { x: from.x + Math.cos(angle) * pop, y: from.y + Math.sin(angle) * pop }
        const control = arcControl(burst, to, Math.min(260, 90 + distance * 0.35), (random() - 0.5) * 0.35 * distance)
        const duration = Math.max(0.75, Math.min(1.15, 0.7 + distance / 2400)) + random() * 0.08
        return {
            delay: index * COIN_STAGGER,
            duration,
            path: s => {
                const t = s / duration
                if (t < 0.2)
                    return {
                        x: lerp(from.x, burst.x, easeOutCubic(t / 0.2)),
                        y: lerp(from.y, burst.y, easeOutCubic(t / 0.2)),
                    }
                return bezier(burst, control, to, easeInQuad((t - 0.2) / 0.8))
            },
        }
    },
    // Shoots straight up, hangs for a moment at the top, then glides down into the counter.
    fountain: ({ from, to, index, random }) => {
        const apex = { x: from.x + (random() - 0.5) * 60, y: from.y - 150 - random() * 70 }
        const control = arcControl(apex, to, 60)
        const duration = 1.15
        return {
            delay: index * 0.07,
            duration,
            path: s => {
                const t = s / duration
                if (t < 0.42) {
                    const p = easeOutCubic(t / 0.42)
                    return { x: lerp(from.x, apex.x, p), y: lerp(from.y, apex.y, p) }
                }
                return bezier(apex, control, to, easeInQuad((t - 0.42) / 0.58))
            },
        }
    },
    // Circles outwards around the checkbox, then leaves the spiral for the counter.
    spiral: ({ from, to, index, count }) => {
        const start = (index / count) * Math.PI * 2
        const centre = { x: from.x, y: from.y - 30 }
        const exitAt = 0.5
        const duration = 1.2
        const spiralPoint = t => {
            const angle = start + t * Math.PI * 3
            const radius = 8 + t * 44
            return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius }
        }
        const exit = spiralPoint(1)
        const control = arcControl(exit, to, 80)
        return {
            delay: index * 0.05,
            duration,
            path: s => {
                const t = s / duration
                if (t < exitAt) {
                    // Eases out of the checkbox into the spiral, so the coin never jumps at the start.
                    const p = easeOutCubic(t / exitAt)
                    const point = spiralPoint(p)
                    const blend = Math.min(1, p * 4)
                    return { x: lerp(from.x, point.x, blend), y: lerp(from.y, point.y, blend) }
                }
                return bezier(exit, control, to, easeInQuad((t - exitAt) / (1 - exitAt)))
            },
        }
    },
    // Lines up in a neat row above the task, then fires off one after the other.
    lineUp: ({ from, to, index, count }) => {
        const slot = { x: from.x + (index - (count - 1) / 2) * 26, y: from.y - 58 }
        const gather = 0.32
        const wait = 0.12 + index * 0.1
        const flight = 0.48
        const duration = gather + wait + flight
        return {
            delay: 0,
            duration,
            path: s => {
                if (s < gather) {
                    const p = easeOutBack(s / gather)
                    return { x: lerp(from.x, slot.x, p), y: lerp(from.y, slot.y, p) }
                }
                if (s < gather + wait) return { x: slot.x, y: slot.y + Math.sin((s - gather) * 14) * 2 }
                const p = easeInCubic((s - gather - wait) / flight)
                return { x: lerp(slot.x, to.x, p), y: lerp(slot.y, to.y, p) }
            },
        }
    },
    // Falls onto the task row, bounces twice, then takes off.
    bounce: ({ from, to, index, random }) => {
        const drift = (random() - 0.5) * 70
        const floor = from.y
        const hop = 0.55
        const duration = 1.2
        const control = arcControl({ x: from.x + drift, y: floor }, to, 120)
        return {
            delay: index * 0.07,
            duration,
            path: s => {
                const t = s / duration
                if (t < hop) {
                    const p = t / hop
                    // Up, down, and two ever smaller bounces.
                    const height = Math.abs(Math.sin(p * Math.PI * 2.5)) * 60 * (1 - p) ** 1.2
                    return { x: from.x + drift * p, y: floor - height }
                }
                return bezier({ x: from.x + drift, y: floor }, control, to, easeInQuad((t - hop) / (1 - hop)))
            },
        }
    },
    // Single file, snaking along a wave like a comet's tail.
    comet: ({ from, to, index, distance }) => {
        const duration = Math.max(0.8, Math.min(1.1, 0.7 + distance / 2600))
        const dx = to.x - from.x
        const dy = to.y - from.y
        const length = Math.hypot(dx, dy) || 1
        const normal = { x: -dy / length, y: dx / length }
        return {
            delay: index * 0.055,
            duration,
            path: s => {
                const p = easeInOutCubic(s / duration)
                const wave = Math.sin(p * Math.PI * 2) * 38 * (1 - p)
                return { x: lerp(from.x, to.x, p) + normal.x * wave, y: lerp(from.y, to.y, p) + normal.y * wave }
            },
        }
    },
    // Coins winding round one another like two strands of a helix.
    helix: ({ from, to, index, distance }) => {
        const duration = Math.max(0.9, Math.min(1.2, 0.8 + distance / 2600))
        const dx = to.x - from.x
        const dy = to.y - from.y
        const length = Math.hypot(dx, dy) || 1
        const normal = { x: -dy / length, y: dx / length }
        const phase = index * Math.PI
        return {
            delay: Math.floor(index / 2) * 0.08,
            duration,
            path: s => {
                const p = easeInOutCubic(s / duration)
                const offset = Math.sin(p * Math.PI * 4 + phase) * 24 * Math.sin(p * Math.PI)
                return { x: lerp(from.x, to.x, p) + normal.x * offset, y: lerp(from.y, to.y, p) + normal.y * offset }
            },
        }
    },
    // A spinning ring hovers above the task for a beat, then every coin zips off at once.
    hover: ({ from, to, index, count }) => {
        const centre = { x: from.x, y: from.y - 64 }
        const gather = 0.3
        const hold = 0.45
        const zip = 0.5
        const duration = gather + hold + zip
        const ring = s => {
            const angle = (index / count) * Math.PI * 2 + s * 5
            return { x: centre.x + Math.cos(angle) * 30, y: centre.y + Math.sin(angle) * 12 }
        }
        return {
            delay: 0,
            duration,
            path: s => {
                if (s < gather) {
                    const p = easeOutCubic(s / gather)
                    const target = ring(s)
                    return { x: lerp(from.x, target.x, p), y: lerp(from.y, target.y, p) }
                }
                if (s < gather + hold) return ring(s)
                const start = ring(gather + hold)
                const p = easeInQuad((s - gather - hold) / zip)
                return { x: lerp(start.x, to.x, p), y: lerp(start.y, to.y, p) }
            },
        }
    },
    // Draws back like a slingshot, then snaps forward into the counter.
    slingshot: ({ from, to, index, random }) => {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const length = Math.hypot(dx, dy) || 1
        const back = {
            x: from.x - (dx / length) * 46 + (random() - 0.5) * 30,
            y: from.y - (dy / length) * 46 + (random() - 0.5) * 30,
        }
        const pull = 0.38
        const shot = 0.42
        const duration = pull + shot
        const control = arcControl(back, to, 50)
        return {
            delay: index * 0.06,
            duration,
            path: s => {
                if (s < pull) {
                    const p = easeOutCubic(s / pull)
                    return { x: lerp(from.x, back.x, p), y: lerp(from.y, back.y, p) }
                }
                return bezier(back, control, to, easeInQuad((s - pull) / shot))
            },
        }
    },
    // Ricochets off two invisible bumpers on its way up, like a pinball.
    pinball: ({ from, to, index, random }) => {
        const dx = to.x - from.x
        const jitter = (random() - 0.5) * 30
        const points = [
            from,
            { x: from.x + dx * 0.3 + jitter, y: from.y - 150 },
            { x: from.x + dx * 0.6 - jitter, y: Math.max(to.y + 140, from.y - 60) },
            to,
        ]
        const duration = 1.15
        return {
            delay: index * 0.07,
            duration,
            path: s => {
                const t = s / duration
                const segment = Math.min(2, Math.floor(t * 3))
                const p = t * 3 - segment
                const eased = segment === 2 ? easeInQuad(p) : easeOutCubic(p)
                const a = points[segment]
                const b = points[segment + 1]
                return { x: lerp(a.x, b.x, eased), y: lerp(a.y, b.y, eased) }
            },
        }
    },
}

export const COIN_STYLE_NAMES = Object.keys(COIN_STYLES)

/**
 * Picks a style at random, never the one used last time — two rewards in a row should not look the
 * same.
 */
export const pickStyle = (names, previous, random = Math.random) => {
    const choices = names.length > 1 ? names.filter(name => name !== previous) : names
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
}

/**
 * @param {{x: number, y: number}} from viewport px (the checkbox centre)
 * @param {{x: number, y: number}} to viewport px (the Gold counter icon centre)
 * @param {number} count coins earned (1-5)
 * @param {() => number} random 0..1
 * @param {string} style one of COIN_STYLE_NAMES (default `arc`)
 */
export function planCoinFlights(from, to, count, random = Math.random, style = 'arc') {
    const make = COIN_STYLES[style] || COIN_STYLES.arc
    const total = Math.max(1, Math.min(8, count))
    const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return Array.from({ length: total }, (_, index) => {
        const flight = make({ from, to, index, count: total, random, distance })
        return {
            ...flight,
            style,
            from: { ...from },
            to: { ...to },
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
    // A hair of tolerance: `delay + duration - delay` can round to just under `duration`.
    if (local >= flight.duration - 1e-9)
        return { started: true, landed: true, x: flight.to.x, y: flight.to.y, scale: 0.7, spin: 0 }
    const { x, y } = flight.path(local)
    return { started: true, landed: false, x, y, scale: scaleFor(local, flight.duration), spin: local * flight.spin }
}
