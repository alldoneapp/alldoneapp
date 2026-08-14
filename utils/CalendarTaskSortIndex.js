import moment from 'moment'

/**
 * AT-2259 / AT-2270 — where a calendar task sits in its group.
 *
 * `sortIndex` is the single key every open-task list orders by (descending). For a normal task it
 * holds the moment the task was CREATED or last moved (`generateSortIndex()` === `Date.now()`), so
 * "newest first" falls out of it.
 *
 * AT-2259: calendar tasks used to store the EVENT START in that very same field — a value in the
 * future. Since `Date.now()` is the ceiling for every normal task's sortIndex, a meeting could
 * never be outranked: adding a task, or even dragging one to position 0, silently left it below
 * the meeting. The write paths stopped doing that and handed calendar tasks an ordinary
 * creation-time index instead.
 *
 * AT-2270 refines the default: a calendar task is not something you chose to put in the list, so
 * by default it belongs at the BOTTOM of its group, and calendar tasks among themselves read best
 * in chronological order. Both are expressed in the same single ordering key — no second field, no
 * display-time special case — by giving an untouched calendar task a sortIndex inside a reserved
 * band far below every generated one:
 *
 *     sortIndex = CALENDAR_DEFAULT_SORT_INDEX_BASE - eventStart
 *
 * Descending order then yields exactly the wanted result: below every ordinary task (their indices
 * are positive millisecond timestamps), and, among calendar tasks, the earliest event on top.
 *
 * Keeping it in `sortIndex` is what makes the second half of the requirement — "still normal tasks
 * you can freely rearrange" — free: drag & drop already reads the rendered order and writes
 * neighbour-derived indices, so a meeting dropped anywhere gets an index that is no longer the
 * derived one. That is precisely the signal for "the user placed this", and everything below
 * (`isDefaultCalendarSortIndex`) treats it as authoritative from then on — the calendar sync never
 * re-sorts it again, not even when the event moves.
 *
 * Reads normalize instead of requiring a data migration. `mapTaskData` — the one place every task
 * enters the app — routes a calendar task's stored index through `resolveTaskSortIndex`, which
 * recognises the three shapes an untouched calendar task can have (the pre-AT-2259 event start,
 * the post-AT-2259 arrival index, and the AT-2270 derived value itself) and maps them onto the
 * derived value. Anything else is user-influenced and is passed through untouched.
 */

const MINUTE_MS = 60 * 1000

// All-day events were persisted through `moment(start.date).utcOffset(userOffset, true)`, so the
// stored value is local midnight for a timezone we cannot know at read time. Every real offset is
// within a day of UTC; 26h covers the extremes with room to spare.
const ALL_DAY_TOLERANCE_MS = 26 * 60 * 60 * 1000

// The calendar sync writes `sortIndex` and `created` microseconds apart, so a calendar task whose
// index still equals its creation stamp has never been moved. A drag writes either "now" (dropped
// at the top) or a neighbour's index ± 1, so the only way to fall inside this window is to
// rearrange a meeting within a second of it appearing — which no sync-driven task can do.
const ARRIVAL_SORT_INDEX_TOLERANCE_MS = 1000

/**
 * The floor every ordinary sortIndex sits above. Generated indices are millisecond timestamps
 * (~1.7e12 and rising), the "no sortIndex stored" fallback is their negation (~-1.7e12), and
 * subtask/template indices live in that same negated range — so a band two orders of magnitude
 * below all of them can never be reached by accident, while `BASE - eventStart` stays far inside
 * `Number.MAX_SAFE_INTEGER`.
 */
export const CALENDAR_DEFAULT_SORT_INDEX_BASE = -1e14

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
 * The event start as used for ORDERING. Identical to `getCalendarEventStartTimestamp` for a timed
 * event (`start.dateTime` carries its own offset), but an all-day event's bare `YYYY-MM-DD` is
 * read as UTC midnight rather than local midnight: the value is written by Cloud Functions and
 * compared in the browser, so it has to be reproducible independently of the reader's timezone.
 * An all-day event therefore sorts at the very start of its day, above that day's meetings.
 */
const getCalendarSortTimestamp = calendarData => {
    const start = calendarData?.start
    if (!start) return null
    if (start.dateTime) return toTimestamp(start.dateTime)
    if (!start.date) return null
    const timestamp = moment.utc(start.date, 'YYYY-MM-DD', true).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * The default position of a calendar task: below every ordinary task in its group, and ordered by
 * event start among the other calendar tasks. Null when the task is not a calendar task (or has no
 * usable event start), which means "leave the ordering alone".
 */
export const getDefaultCalendarSortIndex = calendarData => {
    const eventStart = getCalendarSortTimestamp(calendarData)
    if (eventStart === null) return null
    return CALENDAR_DEFAULT_SORT_INDEX_BASE - eventStart
}

/**
 * True when `sortIndex` is exactly the value AT-2270 derives from this task's CURRENT event start,
 * i.e. the task is still sitting in its default place.
 *
 * Deliberately an exact match rather than a "is it inside the band" test: dropping a meeting
 * between two other meetings necessarily produces a band value too (drag & drop derives it from
 * the neighbours), and that placement must survive. A rescheduled event whose task still carries
 * the value derived from the OLD start therefore reads as "user placed" here — the sync is what
 * re-derives it, because only the sync can see both the old and the new event time.
 */
export const isDefaultCalendarSortIndex = (sortIndex, calendarData) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false
    const defaultSortIndex = getDefaultCalendarSortIndex(calendarData)
    return defaultSortIndex !== null && sortIndex === defaultSortIndex
}

/**
 * True when `sortIndex` still holds the pre-AT-2259 event-start value rather than an ordering the
 * user (or a later write path) produced.
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
 * True when `sortIndex` is the index the sync stamped on arrival (AT-2259 era: an ordinary
 * creation-time value). Recognising it is what lets calendar tasks that were already synced before
 * AT-2270 adopt the new default placement without a data migration.
 */
const isArrivalSortIndex = (sortIndex, created) => {
    if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) return false
    if (typeof created !== 'number' || !Number.isFinite(created)) return false
    return Math.abs(sortIndex - created) <= ARRIVAL_SORT_INDEX_TOLERANCE_MS
}

/**
 * True when nothing has ever moved this calendar task: it still carries whichever index the sync
 * gave it, in any of the three shapes the app has written over time.
 */
export const isUntouchedCalendarSortIndex = (sortIndex, calendarData, created) => {
    if (getDefaultCalendarSortIndex(calendarData) === null) return false
    return (
        isDefaultCalendarSortIndex(sortIndex, calendarData) ||
        isCalendarDerivedSortIndex(sortIndex, calendarData) ||
        isArrivalSortIndex(sortIndex, created)
    )
}

/**
 * The sortIndex the app should order by. Identical to the stored value for every task except a
 * calendar task the user has never moved, which is placed at the bottom of its group in event
 * order. Any sortIndex the user has influenced (drag & drop, postpone, focus, re-assign) is
 * returned exactly as stored.
 */
export const resolveTaskSortIndex = (sortIndex, calendarData, created) => {
    if (!isUntouchedCalendarSortIndex(sortIndex, calendarData, created)) return sortIndex
    return getDefaultCalendarSortIndex(calendarData)
}
