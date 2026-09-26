/**
 * Real money for a completed task. A project can carry an hourly rate per member
 * (`project.hourlyRatesData = { currency, hourlyRates: { [userId]: rate } }`), and the statistics
 * already count a completed task's time estimate as done time — so the task has just earned
 * `estimate / 60 * rate`, the same sum the Statistics view and the revenue OKRs add up. When it is
 * more than nothing, banknotes burst out of the checkbox and flutter down, with the amount rising
 * above them. Pure maths here; the overlay draws it.
 */

const clamp01 = value => Math.max(0, Math.min(1, value))

/** What completing this task earned `userId`, or null when it earned nothing we can name. */
export function getTaskEarnings(project, userId, estimationMinutes) {
    const data = project && project.hourlyRatesData
    const currency = data && data.currency
    const rate = Number(data && data.hourlyRates && data.hourlyRates[userId])
    const minutes = Number(estimationMinutes)
    if (!currency || !(rate > 0) || !(minutes > 0)) return null
    const amount = Math.round((minutes / 60) * rate * 100) / 100
    return amount > 0 ? { amount, currency } : null
}

export function formatEarnings(amount, currency, locale) {
    try {
        return `+${new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)}`
    } catch (error) {
        return `+${amount.toFixed(2)} ${currency}`
    }
}

/** More money, more notes — one per ~25 of the currency, between 3 and 12. */
export const getNoteCount = amount => Math.max(3, Math.min(12, Math.round(amount / 25) + 2))

export const NOTE_LIFE = 1.9
const GRAVITY = 900
const TERMINAL_FALL = 70

/**
 * @param {{x: number, y: number}} from viewport px (the checkbox centre)
 * @param {number} amount
 * @param {() => number} random 0..1
 */
export function planCashBurst(from, amount, random = Math.random, viewportWidth = 1200) {
    // Thrown away from the nearer screen edge: a task near the left edge would otherwise throw half
    // its cash out of the window.
    const centre = viewportWidth / 2
    const bias = Math.max(-1, Math.min(1, (centre - from.x) / centre)) * 200
    return Array.from({ length: getNoteCount(amount) }, (_, index) => ({
        delay: index * 0.035,
        from: { ...from },
        vx: (random() - 0.5) * 420 + bias,
        vy: -(380 + random() * 260),
        sway: 18 + random() * 24,
        swayRate: 3 + random() * 2.5,
        flip: (random() < 0.5 ? -1 : 1) * (4 + random() * 5),
        phase: random() * Math.PI * 2,
        size: 0.85 + random() * 0.35,
    }))
}

/**
 * A note `elapsed` seconds after the burst: thrown up and out, then caught by the air — it falls
 * slowly, swaying side to side and turning over, like paper does, and fades out at the end.
 */
export function notePositionAt(note, elapsed) {
    const t = elapsed - note.delay
    if (t < 0) return { started: false, done: false, x: note.from.x, y: note.from.y, opacity: 0 }
    if (t >= NOTE_LIFE) return { started: true, done: true, x: note.from.x, y: note.from.y, opacity: 0 }
    // Upward throw under gravity until it would fall faster than paper does, then a slow drift.
    const apex = -note.vy / GRAVITY
    let y
    if (t < apex) {
        y = note.from.y + note.vy * t + 0.5 * GRAVITY * t * t
    } else {
        const top = note.from.y + note.vy * apex + 0.5 * GRAVITY * apex * apex
        const fall = t - apex
        const catchUp = Math.min(fall, TERMINAL_FALL / GRAVITY)
        y = top + 0.5 * GRAVITY * catchUp * catchUp + Math.max(0, fall - catchUp) * TERMINAL_FALL
    }
    const drag = 1 - Math.exp(-t * 2.2)
    const x =
        note.from.x + (note.vx / 2.2) * drag + Math.sin(t * note.swayRate + note.phase) * note.sway * clamp01(t / 0.4)
    return {
        started: true,
        done: false,
        x,
        y,
        rotZ: Math.sin(t * note.swayRate + note.phase) * 0.6,
        rotX: Math.sin(t * note.flip * 0.5) * 0.7,
        rotY: t * note.flip * 0.55,
        scale: note.size * Math.min(1, 0.3 + t * 5),
        opacity: 1 - clamp01((t - (NOTE_LIFE - 0.45)) / 0.45),
    }
}
