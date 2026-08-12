const moment = require('moment')

/**
 * AT-2259 / AT-2270 - server-side mirror of `utils/CalendarTaskSortIndex.js` (Cloud Functions
 * cannot import app modules, the same reason `FocusTaskService` mirrors `TASK_PRIORITY_RANK`). Keep
 * the two in sync; `utils/CalendarTaskSortIndex.test.js` pins the shared contract.
 *
 * A calendar task you have never moved sits at the BOTTOM of its group, and calendar tasks among
 * themselves are ordered by event start. That is expressed in the one ordering key every list uses
 * - `sortIndex`, descending - by deriving it from the event start inside a reserved band far below
 * every generated index:
 *
 *     sortIndex = CALENDAR_DEFAULT_SORT_INDEX_BASE - eventStart
 *
 * Because it stays in `sortIndex`, drag & drop keeps working unchanged: dropping a meeting
 * anywhere writes a neighbour-derived index that is no longer the derived value, which is exactly
 * the signal for "the user placed this here" - from then on the sync leaves its position alone.
 *
 * Reads normalize rather than migrate: `mapTaskData` routes every task through
 * `resolveTaskSortIndex`, which recognises the three shapes an untouched calendar task can carry
 * (the pre-AT-2259 event start, the post-AT-2259 arrival index, and the AT-2270 derived value) and
 * maps them onto the derived value.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. 26h covers every
// real offset with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

// The sync writes `sortIndex` and `created` microseconds apart, so a calendar task whose index
// still equals its creation stamp has never been moved.
const ARRIVAL_SORT_INDEX_TOLERANCE_MS = 1000

// Two orders of magnitude below every generated index (millisecond timestamps and their negations),
// so the band can never be reached by accident while staying far inside Number.MAX_SAFE_INTEGER.
const CALENDAR_DEFAULT_SORT_INDEX_BASE = -1e14

const toTimestamp = value => {
    if (!value) return null
    const timestamp = moment(value).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

const getCalendarEventStartTimestamp = calendarData => {
    const start = calendarData && calendarData.start
    if (!start) return null
    return toTimestamp(start.dateTime || start.date)
}

// The event start as used for ORDERING. An all-day event's bare `YYYY-MM-DD` is read as UTC
// midnight, not local midnight: this value is written here and compared in the browser, so it has
// to be reproducible independently of the reader's timezone.
const getCalendarSortTimestamp = calendarData => {
    const start = calendarData && calendarData.start
    if (!start) return null
    if (start.dateTime) return toTimestamp(start.dateTime)
    if (!start.date) return null
    const timestamp = moment.utc(start.date, 'YYYY-MM-DD', true).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

const getDefaultCalendarSortIndex = calendarData => {
    const eventStart = getCalendarSortTimestamp(calendarData)
    if (eventStart === null) return null
    return CALENDAR_DEFAULT_SORT_INDEX_BASE - eventStart
}

// Exact match against the CURRENT event start, never a "is it inside the band" test: dropping a
// meeting between two other meetings produces a band value too, and that placement must survive.
const isDefaultCalendarSortIndex = (sortIndex, calendarData) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false
    const defaultSortIndex = getDefaultCalendarSortIndex(calendarData)
    return defaultSortIndex !== null && sortIndex === defaultSortIndex
}

const isCalendarDerivedSortIndex = (sortIndex, calendarData) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false

    const start = calendarData && calendarData.start
    if (!start) return false

    // Timed events are reproducible to the millisecond: `start.dateTime` carries its own offset.
    if (start.dateTime) return sortIndex === toTimestamp(start.dateTime)

    // All-day events cannot be matched exactly (the writer applied the user's timezone offset), so
    // they are matched by proximity to local midnight AND whole-minute alignment - a generated
    // sortIndex is an arbitrary millisecond, which is what keeps a task dragged next to today's
    // all-day event from being mistaken for a legacy value.
    const localMidnight = toTimestamp(start.date)
    if (localMidnight === null) return false

    return sortIndex % MINUTE_MS === 0 && Math.abs(sortIndex - localMidnight) <= ALL_DAY_TOLERANCE_MS
}

const isArrivalSortIndex = (sortIndex, created) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false
    if (typeof created !== 'number' || !Number.isFinite(created)) return false
    return Math.abs(sortIndex - created) <= ARRIVAL_SORT_INDEX_TOLERANCE_MS
}

const isUntouchedCalendarSortIndex = (sortIndex, calendarData, created) => {
    if (getDefaultCalendarSortIndex(calendarData) === null) return false
    return (
        isDefaultCalendarSortIndex(sortIndex, calendarData) ||
        isCalendarDerivedSortIndex(sortIndex, calendarData) ||
        isArrivalSortIndex(sortIndex, created)
    )
}

const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isUntouchedCalendarSortIndex(sortIndex, calendarData, created)) return sortIndex
    return getDefaultCalendarSortIndex(calendarData)
}

module.exports = {
    CALENDAR_DEFAULT_SORT_INDEX_BASE,
    getCalendarEventStartTimestamp,
    getDefaultCalendarSortIndex,
    isCalendarDerivedSortIndex,
    isDefaultCalendarSortIndex,
    isUntouchedCalendarSortIndex,
    resolveTaskSortIndex,
}
