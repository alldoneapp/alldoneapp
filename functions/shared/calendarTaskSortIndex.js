const moment = require('moment')

/**
 * AT-2259 - server-side mirror of `utils/CalendarTaskSortIndex.js` (Cloud Functions cannot import
 * app modules, the same reason `FocusTaskService` mirrors `TASK_PRIORITY_RANK`). Keep the two in
 * sync; `functions/shared/calendarTaskSortIndex.test.js` pins the shared contract.
 *
 * A calendar task is ordered by when it entered the task list, exactly like a normal task. It used
 * to store the EVENT START in `sortIndex` - a future timestamp that no creation-time index can
 * beat - which pinned meetings to the top of their group. The write paths no longer do that, but
 * documents written before the fix still carry the old value, so reads normalize it onto the
 * task's `created` timestamp instead of requiring a backfill.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. 26h covers every
// real offset with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

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

const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isCalendarDerivedSortIndex(sortIndex, calendarData)) return sortIndex
    return typeof created === 'number' && Number.isFinite(created) ? created : sortIndex
}

module.exports = {
    getCalendarEventStartTimestamp,
    isCalendarDerivedSortIndex,
    resolveTaskSortIndex,
}
