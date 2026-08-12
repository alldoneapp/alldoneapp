'use strict'

const admin = require('firebase-admin')

// AT-2278 — "keep at least N hours of my day unbooked".
//
// This lives in its own module rather than in bookingSettings.js on purpose: the rule is
// consumed by BOTH the availability engine (GoogleCalendar/assistantCalendarTools.js, which
// powers Anna's find_calendar_availability tool) and by Booking/bookingSettings.js, and
// bookingSettings.js already requires the availability engine. Putting the shared normalizer
// and the settings read here keeps that dependency a straight line instead of a cycle.
const DEFAULT_MIN_FREE_HOURS_PER_DAY = 4
const MAX_MIN_FREE_HOURS_PER_DAY = 24
const MIN_FREE_HOURS_SETTINGS_PATH = userId => `users/${userId}/bookingSettings/default`

// Free-time maths is done in float minutes, so compare with a tolerance rather than `<`.
// Without it a day whose free time is exactly the configured minimum can fall on the wrong
// side of the check purely through binary rounding.
const FREE_MINUTES_EPSILON = 1e-6

/**
 * Accepts numbers and numeric strings, clamps to [0, 24] and rounds to two decimals so a
 * value like 3.5 ("three and a half hours") survives a round trip. Anything unparseable
 * falls back — a malformed setting must never silently disable or maximise the rule.
 * 0 is a legitimate value and means "no minimum".
 */
function normalizeMinFreeHoursPerDay(value, fallback = DEFAULT_MIN_FREE_HOURS_PER_DAY) {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '').trim())
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    const clamped = Math.min(parsed, MAX_MIN_FREE_HOURS_PER_DAY)
    return Math.round(clamped * 100) / 100
}

function minFreeHoursToMinutes(hours) {
    return normalizeMinFreeHoursPerDay(hours) * 60
}

/**
 * Reads the user's configured minimum from their meeting settings doc. Fails soft to the
 * 4h default on a missing doc, a missing field, or any read error: an unreachable settings
 * document must not turn into a failed availability search.
 */
async function getMinFreeHoursPerDayForUser(userId) {
    if (!userId) return DEFAULT_MIN_FREE_HOURS_PER_DAY
    try {
        const snapshot = await admin.firestore().doc(MIN_FREE_HOURS_SETTINGS_PATH(userId)).get()
        if (!snapshot || !snapshot.exists) return DEFAULT_MIN_FREE_HOURS_PER_DAY
        const data = (typeof snapshot.data === 'function' ? snapshot.data() : null) || {}
        return normalizeMinFreeHoursPerDay(data.minFreeHoursPerDay)
    } catch (error) {
        console.warn('📅 MIN_FREE_HOURS: falling back to default', {
            userId,
            error: error?.message,
        })
        return DEFAULT_MIN_FREE_HOURS_PER_DAY
    }
}

/**
 * Total busy minutes overlapping [windowStartMs, windowEndMs). Intervals are expected to be
 * already merged (non-overlapping) — merging is what makes a plain sum correct.
 */
function sumBusyMinutesInWindow(intervals = [], windowStartMs, windowEndMs) {
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) return 0

    const busyMs = intervals.reduce((total, interval) => {
        const start = Math.max(Number(interval?.startMs), windowStartMs)
        const end = Math.min(Number(interval?.endMs), windowEndMs)
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total
        return total + (end - start)
    }, 0)

    return busyMs / (60 * 1000)
}

/**
 * The core rule: after adding a meeting of `durationMinutes`, does the day still keep at
 * least `minFreeMinutes` unbooked inside the working-hours window?
 *
 * `capacityMinutes` is the FULL working-hours window of that day, not the slice the caller
 * happened to search. Measuring the searched slice instead would make the rule collapse
 * whenever someone asks a narrow question ("anything this afternoon?"), which is exactly
 * when the day is most likely already full.
 */
function dayKeepsMinimumFreeTime({ capacityMinutes, busyMinutes, durationMinutes, minFreeMinutes }) {
    if (!(minFreeMinutes > 0)) return true
    const freeAfterMeeting = Number(capacityMinutes) - Number(busyMinutes) - Number(durationMinutes)
    return freeAfterMeeting >= minFreeMinutes - FREE_MINUTES_EPSILON
}

module.exports = {
    DEFAULT_MIN_FREE_HOURS_PER_DAY,
    MAX_MIN_FREE_HOURS_PER_DAY,
    dayKeepsMinimumFreeTime,
    getMinFreeHoursPerDayForUser,
    minFreeHoursToMinutes,
    normalizeMinFreeHoursPerDay,
    sumBusyMinutesInWindow,
}
