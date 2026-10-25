const moment = require('moment')

/**
 * AT-2496 - server-side mirror of `utils/CalendarFocusWindow.js` (Cloud Functions cannot import app
 * modules, the same reason this folder already mirrors `calendarTaskOrder` and the legacy sortIndex
 * normalization). Keep the two in sync; `utils/CalendarFocusWindow.test.js` pins the shared
 * contract by driving both through the same cases.
 *
 * See the app-side file for the full reasoning. The short version: the imminent-meeting exception
 * lives in three pickers that must agree, and two of them were dead because they pre-filtered on
 * `sortIndex >= now && sortIndex < now + 15min` - correct only while `sortIndex` held the event
 * start, which AT-2259 deliberately stopped writing. The rule is keyed on `calendarData` and
 * absolute milliseconds only; `sortIndex` is a list position and nothing else.
 */

/** A meeting this close to starting outranks every ordinary task. The historical AT-2251 window. */
const CALENDAR_FOCUS_UPCOMING_WINDOW_MS = 15 * 60 * 1000

/**
 * How long a meeting that has ALREADY STARTED keeps the focus (AT-2496). Capped rather than run to
 * the event's own end because real calendars are full of multi-hour blocks (a 5-hour "Work
 * Blocker", 4-hour personal blocks, a 13-hour festival on the reporting account); uncapped, those
 * would own the focus task for their whole length and disable focus selection during exactly the
 * hours reserved for working. A meeting keeps focus until `min(end, start + this)`.
 */
const CALENDAR_FOCUS_RUNNING_WINDOW_MS = 60 * 60 * 1000

const toTimestamp = value => {
    if (typeof value !== 'string' || value.length === 0) return null
    const timestamp = moment(value).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

/** An all-day event carries `start.date` and no `start.dateTime`. */
const isAllDayStart = calendarData => {
    const start = calendarData && calendarData.start
    return Boolean(start && start.date && !start.dateTime)
}

/**
 * The event's start as absolute ms, or null when this is not a calendar task. This is the field
 * anything deciding focus must read - never `sortIndex`.
 */
const getCalendarFocusStartMs = calendarData => {
    const start = calendarData && calendarData.start
    if (!start) return null
    return toTimestamp(start.dateTime || start.date)
}

/**
 * The instant a running meeting stops being the focus task: its own end, capped by
 * `CALENDAR_FOCUS_RUNNING_WINDOW_MS`. An event with no usable end is covered by the cap alone.
 */
const getRunningUntilMs = (calendarData, startMs) => {
    const cap = startMs + CALENDAR_FOCUS_RUNNING_WINDOW_MS
    const end = calendarData && calendarData.end
    const endMs = end ? toTimestamp(end.dateTime) : null
    if (endMs === null || endMs <= startMs) return cap
    return Math.min(endMs, cap)
}

/**
 * Whether this meeting may take the focus task right now, and on which ground.
 *
 * Returns `null` for anything that may not, `{ startMs, running }` for anything that may.
 *
 * All-day events are deliberately UPCOMING-ONLY: they are birthdays, holidays and multi-day stays,
 * and treating one as "running" would make it the focus task for a whole day, or two.
 */
const getCalendarFocusCandidacy = (calendarData, nowMs) => {
    if (!calendarData || !Number.isFinite(nowMs)) return null

    const startMs = getCalendarFocusStartMs(calendarData)
    if (startMs === null) return null

    if (startMs >= nowMs) {
        // Upcoming: the historical rule, unchanged.
        return startMs < nowMs + CALENDAR_FOCUS_UPCOMING_WINDOW_MS ? { startMs, running: false } : null
    }

    if (isAllDayStart(calendarData)) return null

    return nowMs < getRunningUntilMs(calendarData, startMs) ? { startMs, running: true } : null
}

/** Convenience predicate for callers that do not need to rank. */
const isCalendarFocusCandidate = (calendarData, nowMs) => getCalendarFocusCandidacy(calendarData, nowMs) !== null

/**
 * Ranks two candidacies, best first - use as a comparator (negative means `a` wins).
 *
 * An UPCOMING meeting outranks a running one: it is the actionable nudge. Among upcoming ones the
 * earliest wins (the historical tie-break). Among running ones the LATEST start wins - the meeting
 * most recently walked into, not the long block already sat in.
 */
const compareCalendarFocusCandidacy = (a, b) => {
    if (!a || !b) {
        if (a === b) return 0
        return a ? -1 : 1
    }
    if (a.running !== b.running) return a.running ? 1 : -1
    return a.running ? b.startMs - a.startMs : a.startMs - b.startMs
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The `dueDate` range a focus picker must scan to be sure it sees every candidate.
 *
 * A calendar task's `dueDate` is its event DAY, so a `dueDate` window is a cheap superset of the
 * candidates and - unlike the `sortIndex` window it replaces - rides indexes that already exist on
 * both sides.
 *
 * Derived from `now` in ABSOLUTE milliseconds, deliberately not from local day boundaries: this
 * service only knows the user's day when `timezoneOffset` is passed, and several call paths
 * legitimately leave it null, which would silently miss every meeting for a non-UTC user. See the
 * app-side mirror for the full argument and the bound's derivation.
 */
const getCalendarFocusDueDateWindow = nowMs => ({
    from: nowMs - CALENDAR_FOCUS_RUNNING_WINDOW_MS - DAY_MS,
    to: nowMs + CALENDAR_FOCUS_UPCOMING_WINDOW_MS + DAY_MS,
})

module.exports = {
    CALENDAR_FOCUS_UPCOMING_WINDOW_MS,
    CALENDAR_FOCUS_RUNNING_WINDOW_MS,
    compareCalendarFocusCandidacy,
    getCalendarFocusCandidacy,
    getCalendarFocusDueDateWindow,
    getCalendarFocusStartMs,
    isCalendarFocusCandidate,
}
