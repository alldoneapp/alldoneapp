/**
 * Next-occurrence arithmetic of a recurring task, shared by the Cloud Function that creates the
 * next occurrence (`Tasks/recurringTasksCloud.js`) and the completion popup that previews it
 * (`RecurringTaskDateBasisModal`, AT-3049). One implementation, so the preview cannot disagree
 * with the date the server writes.
 *
 * The module is a factory over `moment` instead of requiring it: the web bundle resolves a bare
 * `require('moment')` from this folder to `functions/node_modules/moment` when that exists, which
 * would ship a second moment copy. Each side passes its own.
 *
 * Pure: no Firestore, no logging.
 */

const RECURRENCE_DAILY = 'daily'
const RECURRENCE_EVERY_WORKDAY = 'everyWorkday'
const RECURRENCE_WEEKLY = 'weekly'
const RECURRENCE_EVERY_2_WEEKS = 'every2Weeks'
const RECURRENCE_EVERY_3_WEEKS = 'every3Weeks'
const RECURRENCE_MONTHLY = 'monthly'
const RECURRENCE_EVERY_3_MONTHS = 'every3Months'
const RECURRENCE_EVERY_6_MONTHS = 'every6Months'
const RECURRENCE_ANNUALLY = 'annually'
const RECURRENCE_CUSTOM = 'custom'

// Custom recurrence is stored as `custom:<days>` (e.g. `custom:28`).
function getCustomRecurrenceDays(recurrence) {
    if (typeof recurrence !== 'string' || recurrence.indexOf(`${RECURRENCE_CUSTOM}:`) !== 0) return null
    const days = parseInt(recurrence.slice(RECURRENCE_CUSTOM.length + 1), 10)
    return Number.isInteger(days) && days > 0 ? days : null
}

// Recurrences that advance by a fixed calendar unit. Skipping ahead from a stale anchor multiplies
// the step (anchor + k * step) instead of chaining single steps, so a monthly task anchored on the
// 31st stays on the last day of each month instead of drifting to the 28th after February.
const FIXED_RECURRENCE_STEPS = {
    [RECURRENCE_DAILY]: [1, 'days'],
    [RECURRENCE_WEEKLY]: [1, 'weeks'],
    [RECURRENCE_EVERY_2_WEEKS]: [2, 'weeks'],
    [RECURRENCE_EVERY_3_WEEKS]: [3, 'weeks'],
    [RECURRENCE_MONTHLY]: [1, 'months'],
    [RECURRENCE_EVERY_3_MONTHS]: [3, 'months'],
    [RECURRENCE_EVERY_6_MONTHS]: [6, 'months'],
    [RECURRENCE_ANNUALLY]: [1, 'years'],
}

function getFixedRecurrenceStep(recurrence) {
    if (FIXED_RECURRENCE_STEPS[recurrence]) return FIXED_RECURRENCE_STEPS[recurrence]
    const customDays = getCustomRecurrenceDays(recurrence)
    return customDays ? [customDays, 'days'] : null
}

const MAX_SKIP_AHEAD_STEPS = 100000

function createRecurrenceSchedule(moment) {
    /** One interval after `baseDate` (a moment), or null for an unknown recurrence. */
    function getNextDateFromBaseDate(baseDate, recurrence) {
        if (recurrence === RECURRENCE_EVERY_WORKDAY) {
            // Friday -> Monday (+3), Saturday -> Monday (+2), otherwise the next day.
            const weekday = baseDate.isoWeekday()
            const days = weekday === 5 ? 3 : weekday === 6 ? 2 : 1
            return baseDate.clone().add(days, 'days')
        }
        const step = getFixedRecurrenceStep(recurrence)
        return step ? baseDate.clone().add(step[0], step[1]) : null
    }

    /**
     * AT-2803: the chosen base date is a CALENDAR DAY of the user. A timestamp alone does not name
     * one: a due date at 00:30 in Berlin is 23:30 UTC the day before, and the server runs in UTC.
     * When the user's offset is known the day is read in it; the time of day still comes from
     * `startTime`, so a series keeps the time its earlier occurrences had.
     */
    function resolveBaseDay(timestamp, utcOffsetMinutes) {
        if (typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes)) {
            return moment(moment(timestamp).utcOffset(utcOffsetMinutes).format('YYYY-MM-DD'), 'YYYY-MM-DD')
        }
        return moment(timestamp)
    }

    const getBaseDateOverride = task =>
        typeof task.recurrenceBaseDateOverride === 'number' &&
        Number.isFinite(task.recurrenceBaseDateOverride) &&
        task.recurrenceBaseDateOverride > 0 &&
        task.recurrenceBaseDateOverride < Number.MAX_SAFE_INTEGER
            ? task.recurrenceBaseDateOverride
            : null

    /**
     * Next occurrence of a recurring task that has just been completed.
     *
     * Without `recurrenceBaseDateOverride` this is the legacy rule: the completion moment plus one
     * interval. With it (the user picked a base date in the completion popup) the interval is
     * applied to that date, and when the result is not after the completion the series skips ahead
     * on its own cadence to the first occurrence that is - the next occurrence is never overdue.
     *
     * Returns `{ nextDate, baseDate, baseDateOverride, startTime, skipAheadFailed }`; `nextDate` is
     * null when the recurrence is unknown or no future occurrence was found.
     */
    function computeNextRecurrence(task, now = Date.now(), options = {}) {
        const startMoment = moment(task.startDate || task.created)
        const startTime = task.startTime || startMoment.format('HH:mm')
        const [hours, minutes] = startTime.split(':').map(Number)
        const baseDateOverride = getBaseDateOverride(task)

        let baseDate = baseDateOverride ? resolveBaseDay(baseDateOverride, options.utcOffsetMinutes) : moment(now)
        baseDate = baseDate.hour(hours).minute(minutes).second(0).millisecond(0)

        let nextDate = getNextDateFromBaseDate(baseDate, task.recurrence)
        const result = { nextDate: null, baseDate, baseDateOverride, startTime, skipAheadFailed: false }
        if (!nextDate) return result

        if (baseDateOverride) {
            const completedMoment = moment(task.completed || now)
            const fixedStep = getFixedRecurrenceStep(task.recurrence)
            let steps = 1
            while (!nextDate.isAfter(completedMoment) && steps < MAX_SKIP_AHEAD_STEPS) {
                steps++
                nextDate = fixedStep
                    ? baseDate.clone().add(fixedStep[0] * steps, fixedStep[1])
                    : getNextDateFromBaseDate(nextDate, task.recurrence)
            }
            if (!nextDate.isAfter(completedMoment)) {
                return { ...result, skipAheadFailed: true }
            }
        }

        return { ...result, nextDate }
    }

    return { getNextDateFromBaseDate, resolveBaseDay, computeNextRecurrence }
}

module.exports = { createRecurrenceSchedule, getCustomRecurrenceDays, getFixedRecurrenceStep }
