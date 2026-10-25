/**
 * Real money for a completed task. A project can carry an hourly rate per member
 * (`project.hourlyRatesData = { currency, hourlyRates: { [userId]: rate } }`), and the statistics
 * already count a completed task's time estimate as done time — so the task has just earned
 * `estimate / 60 * rate`, the same sum the Statistics view and the revenue OKRs add up. When it is
 * more than nothing, banknotes burst out of the checkbox and flutter down, with the amount rising
 * above them. Pure maths here; the overlay draws it.
 */

const clamp01 = value => Math.max(0, Math.min(1, value))
const lerp = (a, b, t) => a + (b - a) * t

// A project billed by the day (`dayRateTimeLog.enabled`, see utils/DayRateTimeLogHelper.js).
const billsByTheDay = project => !!(project && project.dayRateTimeLog && project.dayRateTimeLog.enabled === true)

/**
 * What completing this task earned `userId`, or null when it earned nothing.
 *
 * Two billing models. By the HOUR (the default), the task earned its estimate at the user's rate,
 * and that figure is shown. By the DAY (`project.dayRateTimeLog` enabled), the project bills a whole
 * day, and the number of completed tasks is only the signal that the day counts as worked — no
 * single task earns a share of it. So every task throws cash, but `amount` is null: there is no
 * honest per-task figure to show.
 *
 * @returns {{ amount: number|null, currency: string|null, dayRate: boolean } | null}
 */
export function getTaskEarnings(project, userId, estimationMinutes) {
    const data = project && project.hourlyRatesData
    const currency = (data && data.currency) || null
    if (billsByTheDay(project)) return { amount: null, currency, dayRate: true }
    const rate = Number(data && data.hourlyRates && data.hourlyRates[userId])
    const minutes = Number(estimationMinutes)
    if (!currency || !(rate > 0) || !(minutes > 0)) return null
    const amount = Math.round((minutes / 60) * rate * 100) / 100
    return amount > 0 ? { amount, currency, dayRate: false } : null
}

export function formatEarnings(amount, currency, locale) {
    try {
        return `+${new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)}`
    } catch (error) {
        return `+${amount.toFixed(2)} ${currency}`
    }
}

/** More money, more notes — one per ~25 of the currency, between 3 and 12. */
export const getNoteCount = amount => (amount == null ? 5 : Math.max(3, Math.min(12, Math.round(amount / 25) + 2)))

const GRAVITY = 900
const TERMINAL_FALL = 70

/**
 * Paper physics shared by most styles: thrown with (vx, vy), it rises under gravity until it would
 * fall faster than paper does, then drifts down slowly, swaying side to side and turning over.
 */
const thrown = (from, vx, vy, s, note) => {
    const apex = Math.max(0, -vy / GRAVITY)
    let y
    if (s < apex) {
        y = from.y + vy * s + 0.5 * GRAVITY * s * s
    } else {
        const top = from.y + vy * apex + 0.5 * GRAVITY * apex * apex
        const fall = s - apex
        const catchUp = Math.min(fall, TERMINAL_FALL / GRAVITY)
        y = top + 0.5 * GRAVITY * catchUp * catchUp + Math.max(0, fall - catchUp) * TERMINAL_FALL
    }
    const drag = 1 - Math.exp(-s * 2.2)
    const x = from.x + (vx / 2.2) * drag + Math.sin(s * note.swayRate + note.phase) * note.sway * clamp01(s / 0.4)
    return { x, y, ...paperTurn(s, note) }
}
const paperTurn = (s, note) => ({
    rotZ: Math.sin(s * note.swayRate + note.phase) * 0.6,
    rotX: Math.sin(s * note.flip * 0.5) * 0.7,
    rotY: s * note.flip * 0.55,
})

/**
 * Ten ways for the cash to leave a task. Each returns one note's `delay`, `life` and `path(s)` →
 * `{x, y, rotX, rotY, rotZ}`; fading in and out is added by `notePositionAt`. `ctx` = { from,
 * index, count, random, toward } where `toward` (-1..1) points away from the nearer screen edge, so
 * a task at the edge of the window does not throw its cash out of it.
 */
export const CASH_STYLES = {
    // Thrown up and out, then fluttering down.
    fountain: ({ from, index, random, toward }) => {
        const vx = (random() - 0.5) * 420 + toward * 200
        const vy = -(380 + random() * 260)
        return { delay: index * 0.035, life: 1.9, path: (s, note) => thrown(from, vx, vy, s, note) }
    },
    // Appears above the task and rains down on it.
    rain: ({ from, index, random, toward }) => {
        const start = { x: from.x + (random() - 0.5) * 260 + toward * 80, y: from.y - 170 - random() * 90 }
        return {
            delay: random() * 0.45,
            life: 1.8,
            path: (s, note) => thrown(start, (random() - 0.5) * 20, 30, s, note),
        }
    },
    // Blasts out in every direction, then hangs in the air and drifts.
    explosion: ({ from, index, count, random, toward }) => {
        const angle = (index / count) * Math.PI * 2 + random() * 0.4
        const speed = 520 + random() * 220
        const vx = Math.cos(angle) * speed + toward * 90
        const vy = Math.sin(angle) * speed
        return {
            delay: 0,
            life: 1.5,
            path: (s, note) => {
                const spread = (1 - Math.exp(-s * 5)) / 5
                return {
                    x: from.x + vx * spread,
                    y: from.y + vy * spread + s * s * 40,
                    rotZ: angle + s * note.flip * 0.5,
                    rotX: Math.sin(s * 3) * 0.5,
                    rotY: s * note.flip * 0.4,
                }
            },
        }
    },
    // A money gun: a stream of notes fired in a high arc towards the middle of the screen.
    moneyGun: ({ from, index, random, toward }) => {
        const side = toward >= 0 ? 1 : -1
        const vx = side * (420 + random() * 140)
        const vy = -(520 + random() * 100)
        return { delay: index * 0.07, life: 1.7, path: (s, note) => thrown(from, vx, vy, s, note) }
    },
    // A little tornado: notes whirl upwards around the checkbox, widening as they rise.
    tornado: ({ from, index, count, toward }) => {
        const start = (index / count) * Math.PI * 2
        return {
            delay: index * 0.04,
            life: 1.6,
            path: s => {
                const angle = start + s * 6.5
                const radius = 10 + s * 55
                return {
                    x: from.x + Math.cos(angle) * radius + toward * s * 40,
                    y: from.y - 10 - s * 150,
                    rotZ: angle,
                    rotX: 0.9,
                    rotY: Math.sin(angle) * 0.6,
                }
            },
        }
    },
    // Fanned out above the task like a hand of cards, then let go.
    cardFan: ({ from, index, count, random, toward }) => {
        const spread = count > 1 ? index / (count - 1) - 0.5 : 0
        const angle = spread * 1.6
        const held = { x: from.x + toward * 30 + Math.sin(angle) * 34, y: from.y - 44 - Math.cos(angle) * 22 }
        const open = 0.35
        const hold = 0.35
        const vx = Math.sin(angle) * 260 + toward * 60
        return {
            delay: 0,
            life: open + hold + 1.2,
            path: (s, note) => {
                if (s < open) {
                    const p = 1 - (1 - s / open) ** 3
                    return {
                        x: lerp(from.x, held.x, p),
                        y: lerp(from.y, held.y, p),
                        rotZ: -angle * p,
                        rotX: 0,
                        rotY: 0,
                    }
                }
                if (s < open + hold) return { x: held.x, y: held.y, rotZ: -angle, rotX: 0, rotY: 0 }
                const flown = thrown(held, vx, -160 - random() * 40, s - open - hold, note)
                return { ...flown, rotZ: flown.rotZ - angle }
            },
        }
    },
    // A geyser: a tight column shoots high, then scatters at the top.
    geyser: ({ from, index, random, toward }) => {
        const vx = (random() - 0.5) * 120 + toward * 60
        const vy = -(760 + random() * 160)
        return { delay: index * 0.045, life: 2.0, path: (s, note) => thrown(from, vx, vy, s, note) }
    },
    // A wave: notes glide sideways across the screen, rising and falling in step.
    wave: ({ from, index, random, toward }) => {
        const side = toward >= 0 ? 1 : -1
        const lane = (random() - 0.5) * 30
        return {
            delay: index * 0.08,
            life: 1.6,
            path: s => {
                const travel = (1 - Math.exp(-s * 1.8)) / 1.8
                return {
                    x: from.x + side * travel * 340,
                    y: from.y - 36 + lane + Math.sin(s * 7 + index * 0.9) * 20,
                    rotZ: Math.cos(s * 7 + index * 0.9) * 0.4 * side,
                    rotX: 0.6,
                    rotY: Math.sin(s * 3) * 0.4,
                }
            },
        }
    },
    // Floats gently upwards like a bunch of balloons, swaying.
    floatUp: ({ from, index, random, toward }) => {
        const offset = (random() - 0.5) * 120 + toward * 30
        const rise = 80 + random() * 50
        return {
            delay: index * 0.06,
            life: 1.8,
            path: (s, note) => ({
                x: from.x + offset * (1 - Math.exp(-s * 3)) + Math.sin(s * note.swayRate + note.phase) * 14,
                y: from.y - 20 - s * rise,
                rotZ: Math.sin(s * note.swayRate + note.phase) * 0.35,
                rotX: 0.3,
                rotY: Math.sin(s * 2 + note.phase) * 0.5,
            }),
        }
    },
    // Piles up into a little stack on the task, then the stack bursts.
    stack: ({ from, index, count, random, toward }) => {
        const drop = 0.1 + index * 0.06
        const burstAt = 0.18 + count * 0.06 + 0.2
        const rest = { x: from.x + toward * 20 + (random() - 0.5) * 6, y: from.y - 18 - index * 4 }
        const angle = (random() - 0.5) * 0.4
        const vx = (random() - 0.5) * 460 + toward * 160
        const vy = -(300 + random() * 220)
        return {
            delay: 0,
            life: burstAt + 1.4,
            path: (s, note) => {
                if (s < drop) {
                    const p = s / drop
                    return { x: rest.x, y: rest.y - 60 * (1 - p * p), rotZ: angle, rotX: 1.35, rotY: 0 }
                }
                if (s < burstAt) return { x: rest.x, y: rest.y, rotZ: angle, rotX: 1.35, rotY: 0 }
                return thrown(rest, vx, vy, s - burstAt, note)
            },
        }
    },
}

export const CASH_STYLE_NAMES = Object.keys(CASH_STYLES)

/**
 * @param {{x: number, y: number}} from viewport px (the checkbox centre)
 * @param {number|null} amount
 * @param {() => number} random 0..1
 * @param {number} viewportWidth
 * @param {string} style one of CASH_STYLE_NAMES (default `fountain`)
 */
export function planCashBurst(from, amount, random = Math.random, viewportWidth = 1200, style = 'fountain') {
    const make = CASH_STYLES[style] || CASH_STYLES.fountain
    const centre = viewportWidth / 2
    const toward = Math.max(-1, Math.min(1, (centre - from.x) / centre))
    const count = getNoteCount(amount)
    return Array.from({ length: count }, (_, index) => {
        const note = {
            style,
            from: { ...from },
            sway: 18 + random() * 24,
            swayRate: 3 + random() * 2.5,
            flip: (random() < 0.5 ? -1 : 1) * (4 + random() * 5),
            phase: random() * Math.PI * 2,
            size: 0.85 + random() * 0.35,
        }
        return { ...note, ...make({ from, index, count, random, toward }) }
    })
}

/**
 * A note `elapsed` seconds after the burst, faded in over its first moment and out over its last.
 */
export function notePositionAt(note, elapsed) {
    const s = elapsed - note.delay
    if (s < 0) return { started: false, done: false, x: note.from.x, y: note.from.y, opacity: 0 }
    if (s >= note.life - 1e-9) {
        return {
            started: true,
            done: true,
            x: note.from.x,
            y: note.from.y,
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            scale: 0,
            opacity: 0,
        }
    }
    const position = note.path(s, note)
    return {
        started: true,
        done: false,
        ...position,
        scale: note.size * Math.min(1, 0.3 + s * 5),
        opacity: Math.min(clamp01(s / 0.12), 1 - clamp01((s - (note.life - 0.45)) / 0.45)),
    }
}
