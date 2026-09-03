import moment from 'moment'

/**
 * AT-2496 — when a meeting may beat every other candidate for the focus task.
 *
 * The imminent-meeting exception is documented in AT-2251 and implemented in THREE pickers that
 * must agree (the optimistic client pick, the authoritative client picker in `tasksFirestore.js`,
 * and `FocusTaskService` Phase 1 in the Cloud Function). Before this ticket the rule was written out
 * by hand in each of them, and two of the three were dead:
 *
 *   Both authoritative pickers pre-filtered their Firestore query with
 *   `sortIndex >= now && sortIndex < now + 15min`. That was correct only while `sortIndex` HELD THE
 *   EVENT START — the pre-AT-2259 encoding. AT-2259 deliberately stopped writing it, so today a
 *   calendar task's `sortIndex` is `generateCalendarTaskSortIndex()` = the sync-time "now"
 *   (`functions/GoogleCalendarTasks/calendarTasks.js`), stamped once at creation, hours BEFORE the
 *   meeting. `sortIndex >= now` is therefore false for the whole life of the task and the query
 *   returned nothing. Production bore that out exactly: of 119 real calendar tasks across the
 *   reporting account's two calendar-connected projects, ZERO had a `sortIndex` that could ever
 *   match — today's entries were synced at 05:37 for a 13:00 start. The only documents where
 *   `sortIndex == event start` are pre-AT-2259 leftovers.
 *
 * The optimistic pick never had the bug because it reads `calendarData.start` out of Redux, so the
 * user-visible symptom was AT-2251 in reverse: finish a task shortly before a meeting, see the
 * meeting appear as the new focus task, then watch it flip away to an ordinary task the moment an
 * authoritative picker answered.
 *
 * So the rule now lives in ONE place, keyed on `calendarData` and absolute milliseconds only —
 * never on `sortIndex`, which is a list position and nothing else. The pickers keep their own
 * Firestore pre-filters (they must, and they use `dueDate`, which for a calendar task IS the event
 * day), but the pre-filter is only ever allowed to be a cheap superset: what actually decides is
 * this module.
 *
 * Server mirror: `functions/shared/calendarFocusWindow.js` (Cloud Functions cannot import app
 * modules — the same reason this folder already mirrors `CalendarTaskOrder` and the legacy
 * `sortIndex` normalization). `utils/CalendarFocusWindow.test.js` drives BOTH through the same
 * cases so they cannot drift.
 */

/** A meeting this close to starting outranks every ordinary task. The historical AT-2251 window. */
export const CALENDAR_FOCUS_UPCOMING_WINDOW_MS = 15 * 60 * 1000

/**
 * How long a meeting that has ALREADY STARTED keeps the focus (AT-2496).
 *
 * The gap this closes: finishing a task ten minutes into a meeting handed focus to an unrelated
 * task, because only `[now, now+15min)` qualified. The literal reading — "focus while
 * `start <= now < end`" — is what was asked for, and it is capped here rather than taken at face
 * value because of what real calendars contain. On the reporting account the median timed event is
 * 90 minutes but 36 of 94 run longer: a 5-hour "Work Blocker", six 4-hour "Jacob Zeit" blocks, a
 * 13-hour festival. Uncapped, every one of those would own the focus task for its whole length, so
 * every task completed inside a work block would hand focus straight back to the block — the
 * feature would silently disable focus selection during exactly the hours reserved for working.
 *
 * A meeting therefore keeps focus until `min(end, start + this)`: a short meeting is covered for
 * its whole length, a long block only around its start, which is where the nudge is worth anything.
 */
export const CALENDAR_FOCUS_RUNNING_WINDOW_MS = 60 * 60 * 1000

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
 * anything deciding focus must read — never `sortIndex`.
 */
export const getCalendarFocusStartMs = calendarData => {
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
 * All-day events are deliberately UPCOMING-ONLY. They are birthdays, holidays and multi-day stays
 * — the reporting account's are "Oliver Budde Geburtstag" and a two-day "Stay at Motel One" — and
 * treating one as "running" would make it the focus task for a whole day, or two. It is not a
 * meeting you are in; it is a label on the day.
 */
export const getCalendarFocusCandidacy = (calendarData, nowMs) => {
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
export const isCalendarFocusCandidate = (calendarData, nowMs) => getCalendarFocusCandidacy(calendarData, nowMs) !== null

/**
 * Ranks two candidacies, best first — use as a comparator (negative means `a` wins).
 *
 * An UPCOMING meeting outranks a running one: it is the actionable nudge, the thing you have to
 * move for. Among upcoming ones the earliest wins (the historical tie-break). Among running ones
 * the LATEST start wins — that is the meeting you have most recently walked into, not the long
 * block you have been sitting in.
 */
export const compareCalendarFocusCandidacy = (a, b) => {
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
 * candidates and — unlike the `sortIndex` window it replaces — rides indexes that already exist on
 * both sides.
 *
 * Derived from `now` in ABSOLUTE milliseconds, deliberately not from local day boundaries. The
 * obvious implementation is `[startOf('day'), endOf('day')]`, and it is a trap: the Cloud Function
 * only knows the user's day if `timezoneOffset` was passed, and several call paths legitimately
 * leave it null (`workflowFocusHandoff` initialises it to null and only fills it in from the user
 * document). A null offset means UTC day boundaries, and production `dueDate` values are LOCAL
 * midnight — for the reporting account at UTC+2 that is 22:00 the previous UTC day, i.e. outside a
 * UTC-day window. Every meeting would be missed, silently, for exactly the non-UTC users the
 * feature exists for. That is the same shape of failure as the bug this ticket fixes, so the
 * window simply does not depend on knowing the timezone.
 *
 * The bound is provable: a candidate's start is within `[now - RUNNING, now + UPCOMING]`, and its
 * `dueDate` sits somewhere inside that event's own local day, i.e. within ±24h of the start. So
 * every candidate's `dueDate` lies in the range below, whatever the reader's or the event's
 * timezone.
 */
export const getCalendarFocusDueDateWindow = nowMs => ({
    from: nowMs - CALENDAR_FOCUS_RUNNING_WINDOW_MS - DAY_MS,
    to: nowMs + CALENDAR_FOCUS_UPCOMING_WINDOW_MS + DAY_MS,
})
