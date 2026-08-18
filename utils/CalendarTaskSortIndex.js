import moment from 'moment'

/**
 * AT-2351 — read-time repair of the two `sortIndex` encodings this app has since abandoned.
 *
 * Where a calendar task RENDERS is no longer stored anywhere. It is decided when the group is
 * ordered, by `orderCalendarTasksLast` in `utils/CalendarTaskOrder.js` — see that file for why the
 * rule moved out of the data. `sortIndex` is back to meaning one thing for every task, calendar or
 * not: where the user put it in the list.
 *
 * Two historical shapes are still sitting in production documents, and both are actively harmful if
 * read as a list position:
 *
 *   - **AT-2259 and earlier — the event start.** A future timestamp. `generateSortIndex()` returns
 *     `Date.now()`, so nothing can ever outrank it: such a task hogs the top of its group and, more
 *     importantly, the top of the `orderBy('sortIndex', 'desc').limit(200)` window that
 *     `findAndSetNewFocusedTask` scans to pick the next focus task.
 *   - **AT-2270 — the reserved band, `-1e14 - eventStart`.** Two orders of magnitude below every
 *     real index. Drag & drop derives a dropped task's index from its NEIGHBOURS, so a normal task
 *     dropped below a banded meeting inherited a value near -1e14 and sank below every other task
 *     in the list, permanently.
 *
 * Both are mapped onto the task's `created` stamp — the same value a task gets when it has no
 * stored index at all, and the honest answer to "when did this enter the list". That is a read-side
 * repair, not a migration: documents are left alone and simply stop being misread. Because the band
 * is unreachable by any generator, the band rule is applied to EVERY task rather than only calendar
 * ones — that is what rescues a normal task a user dragged underneath a meeting.
 *
 * Everything else is passed through untouched. Note what is deliberately NOT here any more: there
 * is no "has the user moved this?" heuristic. Nothing depends on guessing that, because no rendered
 * position depends on the stored number for a calendar task.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. Every real offset is
// within a day of UTC; 26h covers the extremes with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

/** The base AT-2270 derived its band from: `sortIndex = CALENDAR_LEGACY_SORT_INDEX_BASE - eventStart`. */
export const CALENDAR_LEGACY_SORT_INDEX_BASE = -1e14

/**
 * Anything at or below this is a band value and cannot be anything else. Real indices are
 * millisecond timestamps (~1.7e12) or their negation (~-1.7e12) for subtasks, templates and the
 * "no stored index" fallback — an order of magnitude away from this threshold, so the test needs no
 * knowledge of the event that produced the value.
 */
const CALENDAR_LEGACY_BAND_CEILING = -1e13

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

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

/** True for an AT-2270 band value, on any task. */
export const isLegacyCalendarBandSortIndex = sortIndex =>
    isFiniteNumber(sortIndex) && sortIndex <= CALENDAR_LEGACY_BAND_CEILING

/**
 * True when `sortIndex` still holds the pre-AT-2259 event start rather than a list position.
 *
 * Timed events are matched exactly: both writers derived the value with
 * `moment(start.dateTime).valueOf()`, and `start.dateTime` carries its own offset, so the number is
 * reproducible. A generated index colliding with it to the millisecond is not a realistic case.
 *
 * All-day events cannot be matched exactly because the writer applied the user's timezone offset.
 * They are matched by proximity to local midnight PLUS whole-minute alignment: a calendar-derived
 * value is always minute-aligned, while `generateSortIndex()` returns an arbitrary millisecond.
 * That second condition is what keeps a task dragged next to today's all-day event from being
 * mistaken for a legacy value.
 */
export const isLegacyCalendarEventStartSortIndex = (sortIndex, calendarData) => {
    if (!isFiniteNumber(sortIndex)) return false

    const start = calendarData?.start
    if (!start) return false

    if (start.dateTime) return sortIndex === toTimestamp(start.dateTime)

    const localMidnight = toTimestamp(start.date)
    if (localMidnight === null) return false

    return sortIndex % MINUTE_MS === 0 && Math.abs(sortIndex - localMidnight) <= ALL_DAY_TOLERANCE_MS
}

/**
 * The sortIndex the app should order by: the stored value, unless it is one of the two abandoned
 * encodings above, in which case the task's `created` stamp. Applied in `mapTaskData` — the one
 * place every task enters the app — so no consumer has to know these shapes ever existed.
 */
export const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isFiniteNumber(sortIndex)) return sortIndex
    if (!isFiniteNumber(created)) return sortIndex

    if (isLegacyCalendarBandSortIndex(sortIndex)) return created
    if (isLegacyCalendarEventStartSortIndex(sortIndex, calendarData)) return created

    return sortIndex
}
