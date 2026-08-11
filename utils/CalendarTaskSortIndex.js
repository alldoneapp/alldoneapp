import moment from 'moment'

/**
 * AT-2259 — calendar tasks used to be pinned to the top of their group.
 *
 * `sortIndex` is the single key every open-task list orders by (descending). For a normal task it
 * holds the moment the task was CREATED or last moved (`generateSortIndex()` === `Date.now()`), so
 * "newest first" falls out of it. Calendar tasks, however, stored the EVENT START timestamp in the
 * very same field — a value in the future. Since `Date.now()` is the ceiling for every normal
 * task's sortIndex, a calendar event in a future group could never be outranked: adding a task or
 * even dragging one to position 0 silently left it below the meeting.
 *
 * The fix is to stop overloading the field. Calendar tasks now get an ordinary creation-time
 * sortIndex like everything else, and the event start is read from `calendarData.start` by the few
 * places that genuinely need it (My Day timeline, the imminent-meeting focus rule).
 *
 * Documents written before that change still carry the event-start value, and the calendar sync
 * only writes `sortIndex` when it CREATES a task — so those would stay pinned forever without a
 * backfill. Instead of migrating data, `mapTaskData` normalizes on read: a sortIndex that is
 * recognisably the untouched calendar-derived value is replaced with the task's `created`
 * timestamp, which is what a normal task of the same age would have carried. Any sortIndex the
 * user has since influenced (drag & drop, postpone, focus) is left exactly as stored.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. Every real offset is
// within a day of UTC; 26h covers the extremes with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

const toTimestamp = value => {
    if (!value) return null
    const timestamp = moment(value).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * The start of a calendar task's event, or null when the task is not a calendar task. This is the
 * field anything that needs the event time should read — never `sortIndex`.
 */
export const getCalendarEventStartTimestamp = calendarData => {
    const start = calendarData?.start
    if (!start) return null
    return toTimestamp(start.dateTime || start.date)
}

/**
 * True when `sortIndex` still holds the legacy calendar-derived value rather than an ordering the
 * user (or the new write path) produced.
 *
 * Timed events are matched exactly: both the server and the client derived the value with
 * `moment(start.dateTime).valueOf()`, and `start.dateTime` carries its own offset, so the number is
 * reproducible. A generated sortIndex colliding with it to the millisecond is not a realistic case.
 *
 * All-day events cannot be matched exactly because the writer applied the user's timezone offset.
 * They are matched by proximity to local midnight PLUS whole-minute alignment: a calendar-derived
 * value is always minute-aligned, while `generateSortIndex()` returns an arbitrary millisecond.
 * That second condition is what keeps a task dragged next to today's all-day event from being
 * mistaken for a legacy value.
 */
export const isCalendarDerivedSortIndex = (sortIndex, calendarData) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false

    const start = calendarData?.start
    if (!start) return false

    if (start.dateTime) {
        return sortIndex === toTimestamp(start.dateTime)
    }

    const localMidnight = toTimestamp(start.date)
    if (localMidnight === null) return false

    return sortIndex % MINUTE_MS === 0 && Math.abs(sortIndex - localMidnight) <= ALL_DAY_TOLERANCE_MS
}

/**
 * The sortIndex the app should order by. Identical to the stored value for every task except a
 * calendar task that still carries the legacy event-start value, which is mapped onto the moment
 * the task entered the list.
 */
export const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isCalendarDerivedSortIndex(sortIndex, calendarData)) return sortIndex
    return typeof created === 'number' && Number.isFinite(created) ? created : sortIndex
}
