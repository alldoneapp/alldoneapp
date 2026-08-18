const moment = require('moment')

/**
 * AT-2351 - server-side mirror of `utils/CalendarTaskSortIndex.js` (Cloud Functions cannot import
 * app modules, the same reason `FocusTaskService` mirrors `TASK_PRIORITY_RANK`). Keep the two in
 * sync; `utils/CalendarTaskSortIndex.test.js` pins the shared contract.
 *
 * Where a calendar task renders is no longer stored - it is decided when a group is ordered, by
 * `orderCalendarTasksLast` in `utils/CalendarTaskOrder.js`. `sortIndex` means one thing again for
 * every task: where the user put it in the list.
 *
 * What remains here is read-time repair of the two encodings the app has abandoned, both of which
 * are harmful when read as a list position:
 *
 *   - AT-2259 and earlier: the EVENT START, a future timestamp no generated index can outrank. It
 *     pins the task to the top of its group and to the top of the `orderBy('sortIndex','desc')`
 *     window `FocusTaskService` scans when picking the next focus task.
 *   - AT-2270: the reserved band `-1e14 - eventStart`. Drag & drop derives a dropped task's index
 *     from its neighbours, so a normal task dropped below a banded meeting inherited ~-1e14 and
 *     sank below everything else permanently.
 *
 * Both map onto the task's `created` stamp. The band rule applies to EVERY task, not just calendar
 * ones, because no generator can produce a band value - that is what rescues a normal task dragged
 * underneath a meeting.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. 26h covers every
// real offset with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

// The base AT-2270 derived its band from: `sortIndex = CALENDAR_LEGACY_SORT_INDEX_BASE - eventStart`.
const CALENDAR_LEGACY_SORT_INDEX_BASE = -1e14

// Anything at or below this is a band value and cannot be anything else: real indices are
// millisecond timestamps (~1.7e12) or their negation, an order of magnitude away.
const CALENDAR_LEGACY_BAND_CEILING = -1e13

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

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

const isLegacyCalendarBandSortIndex = sortIndex =>
    isFiniteNumber(sortIndex) && sortIndex <= CALENDAR_LEGACY_BAND_CEILING

const isLegacyCalendarEventStartSortIndex = (sortIndex, calendarData) => {
    if (!isFiniteNumber(sortIndex)) return false

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

const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isFiniteNumber(sortIndex)) return sortIndex
    if (!isFiniteNumber(created)) return sortIndex

    if (isLegacyCalendarBandSortIndex(sortIndex)) return created
    if (isLegacyCalendarEventStartSortIndex(sortIndex, calendarData)) return created

    return sortIndex
}

module.exports = {
    CALENDAR_LEGACY_SORT_INDEX_BASE,
    getCalendarEventStartTimestamp,
    isLegacyCalendarBandSortIndex,
    isLegacyCalendarEventStartSortIndex,
    resolveTaskSortIndex,
}
