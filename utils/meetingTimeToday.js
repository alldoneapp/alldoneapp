/**
 * AT-3136 — "Meetings today / calendar-free working time" in the All projects line.
 *
 * Pure maths, no Firestore and no React, so every edge case is unit-testable
 * (`meetingTimeToday.test.js`). The hook (`components/TaskListView/Header/AllProjectsLine/
 * useMeetingTimeToday.js`) feeds it the user's synced meeting tasks and their working hours.
 *
 * ## Where the working hours come from
 *
 * There is no working-hours setting in My Day. The only stored one is the "Arbeitszeiten" block of
 * the public meeting link settings (`users/{uid}/bookingSettings/default`, `workingHoursStart` /
 * `workingHoursEnd` as "HH:mm"), which Anna's `find_calendar_availability` already uses as "the
 * user's working day". This feature reuses it instead of adding a second setting. A user who never
 * saved those settings gets the same 09:00–17:00 default the settings screen and the server use,
 * and the UI says so ("Default hours") instead of presenting it as the user's own choice.
 *
 * The clock times are read in the DEVICE's local timezone for the device's local today. The
 * stored `timeZone` of that doc is not used: the settings screen never sends one, so the server
 * fills it from `users/{uid}.timezone`, which is usually an integer hour offset and therefore
 * resolves to "UTC" for many users.
 *
 * ## What counts as a meeting (same conventions as the calendar integration)
 *
 * - A meeting is a task carrying `calendarData` (`isCalendarTask`). Cancelled events and events the
 *   user declined never become tasks (`filterEvents` in `functions/GoogleCalendarTasks/
 *   calendarTasks.js`), and a declined/cancelled event is deleted again by the next sync.
 * - All-day events (`start.date`) and timed events that span several calendar days are NOT busy
 *   time, exactly like the availability engine (`normalizeGoogleBusyInterval` in
 *   `functions/GoogleCalendar/assistantCalendarTools.js`). They are markers or blocks, not meetings.
 * - A meeting is clipped to the working-hours window; overlapping meetings and the same event
 *   imported twice (two connected calendars, two projects) are merged before summing, so no minute
 *   is counted twice.
 *
 * ## Solo work blocks are time to work (AT-3136, decided with the user 2026-11-23)
 *
 * An event is left out of the meeting time only when BOTH are stored on the calendar task:
 *
 * - `calendarData.soloEvent === true`: the sync found nobody else in it AND the user is verifiably
 *   its organizer (`getSoloEventFlag` in functions/GoogleCalendarTasks/calendarTasks.js). Nobody
 *   else "accepted" is not enough: invitees who have not answered or declined still make it a
 *   meeting. Missing or unclear participant data (tasks synced before the field existed, a group
 *   calendar organizer, hidden guest lists) leaves the field unset.
 * - `calendarData.workBlock === true`: Google "Focus time", or the calendar routing model judged it
 *   a block for the user's own work. A private solo appointment (doctor, childcare) still counts:
 *   it is not time to work.
 *
 * Everything unknown stays a meeting, so a gap in the data can only make "time to work" smaller,
 * never larger. Only the union of the remaining (meeting) intervals is counted, so a solo block that
 * overlaps a real meeting neither adds nor removes anything there.
 *
 * ## "Time to work" is what is still available from now (AT-3136, user correction 2026-11-23)
 *
 * The large figure is the calendar-free time in the REST of today's working window,
 * [max(now, start), end): before the working day the whole window, after it 0. Free time that has
 * passed is no longer available; an ongoing meeting only takes its remaining part. The meeting total
 * next to it stays the whole working day's (meetings already over still count), so the two figures
 * no longer add up to the window during the day; the tooltip says which is which. The hook
 * re-evaluates this every minute and on tab focus/visibility (`useMinuteClock`), not only when the
 * calendar syncs.
 */

import moment from 'moment-timezone'

export const DEFAULT_WORKING_HOURS_START = '09:00'
export const DEFAULT_WORKING_HOURS_END = '17:00'

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MS_PER_MINUTE = 60 * 1000

const clockToMinutes = clock => {
    const [hours, minutes] = clock.split(':').map(Number)
    return hours * 60 + minutes
}

const trimmed = value => (typeof value === 'string' ? value.trim() : '')

/**
 * `settings` is the booking settings document data, or null/undefined when the doc does not exist.
 * Returns `{ start, end, isDefault }`. Malformed or inverted saved hours fall back to the default
 * (the server refuses to save an end before the start, so this only guards legacy data).
 */
export const resolveWorkingHours = settings => {
    const start = trimmed(settings?.workingHoursStart)
    const end = trimmed(settings?.workingHoursEnd)
    if (CLOCK_PATTERN.test(start) && CLOCK_PATTERN.test(end) && clockToMinutes(end) > clockToMinutes(start)) {
        return { start, end, isDefault: false }
    }
    return { start: DEFAULT_WORKING_HOURS_START, end: DEFAULT_WORKING_HOURS_END, isDefault: true }
}

/**
 * Today's working window in the device's local time: `{ startMs, endMs, minutes }`. The whole day
 * window, not "from now on": the meeting total counts meetings that already happened today too
 * (the remaining part for "time to work" is `getRemainingWindow`).
 */
export const getWorkingWindow = ({ start, end }, nowMs = Date.now()) => {
    const day = moment(nowMs).startOf('day')
    const startMs = day.clone().add(clockToMinutes(start), 'minutes').valueOf()
    const endMs = day.clone().add(clockToMinutes(end), 'minutes').valueOf()
    return { startMs, endMs, minutes: Math.max(0, (endMs - startMs) / MS_PER_MINUTE) }
}

export const WORKDAY_BEFORE = 'before'
export const WORKDAY_DURING = 'during'
export const WORKDAY_AFTER = 'after'

/**
 * The part of today's working window that is still ahead (AT-3136, user correction 2026-11-23:
 * "free hours that have already passed are no longer available"):
 *
 *   [max(now, window start), window end)
 *
 * Before the working day it is the whole window, during it it starts now, after it it is empty.
 * Returns `{ startMs, endMs, minutes, phase }`.
 */
export const getRemainingWindow = (window, nowMs = Date.now()) => {
    const { startMs: windowStartMs, endMs } = window
    let phase = WORKDAY_DURING
    if (nowMs < windowStartMs) phase = WORKDAY_BEFORE
    else if (nowMs >= endMs) phase = WORKDAY_AFTER
    const startMs = Math.min(Math.max(nowMs, windowStartMs), endMs)
    return { startMs, endMs, minutes: Math.max(0, (endMs - startMs) / MS_PER_MINUTE), phase }
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Google stores `dateTime` with its offset ("2026-11-23T10:00:00+01:00"). The Microsoft provider
 * asks Graph for UTC and stores the bare wall time plus `timeZone: 'UTC'`
 * ("2026-11-23T09:00:00.0000000"), so a value without an offset is read in its own `timeZone`
 * (UTC when missing or unknown), never in the reader's local zone.
 */
const parseCalendarDateTime = (raw, timeZone) => {
    const parsed = HAS_OFFSET.test(raw)
        ? moment(raw, moment.ISO_8601, true)
        : moment.tz(raw, moment.ISO_8601, true, moment.tz.zone(trimmed(timeZone)) ? trimmed(timeZone) : 'UTC')
    return parsed.isValid() ? parsed.valueOf() : NaN
}

/**
 * The busy interval of one meeting task, or null when it is not busy time (no calendar data,
 * all-day, multi-day, unparsable or zero-length).
 */
export const getMeetingInterval = task => {
    const calendarData = task?.calendarData
    if (!calendarData) return null
    const { start, end } = calendarData
    if (!start || !end || start.date || end.date) return null

    const startRaw = trimmed(start.dateTime)
    const endRaw = trimmed(end.dateTime)
    if (!startRaw || !endRaw) return null
    // Event-local calendar days, compared on the raw value like the availability engine does.
    if (startRaw.substring(0, 10) !== endRaw.substring(0, 10)) return null

    const startMs = parseCalendarDateTime(startRaw, start.timeZone)
    const endMs = parseCalendarDateTime(endRaw, end.timeZone)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
    return { startMs, endMs }
}

/** Sorted, non-overlapping union of the intervals clipped to [windowStartMs, windowEndMs). */
export const mergeIntervalsInWindow = (intervals, windowStartMs, windowEndMs) => {
    const clipped = (intervals || [])
        .map(interval => ({
            startMs: Math.max(interval.startMs, windowStartMs),
            endMs: Math.min(interval.endMs, windowEndMs),
        }))
        .filter(interval => interval.endMs > interval.startMs)
        .sort((a, b) => a.startMs - b.startMs)

    const merged = []
    clipped.forEach(interval => {
        const previous = merged[merged.length - 1]
        if (previous && interval.startMs <= previous.endMs) {
            previous.endMs = Math.max(previous.endMs, interval.endMs)
        } else {
            merged.push({ ...interval })
        }
    })
    return merged
}

/** True only for a reliably solo event that is a block of the user's own work (see above). */
export const isSoloWorkBlock = task => task?.calendarData?.soloEvent === true && task.calendarData.workBlock === true

/**
 * The same task document can reach us twice (the open and the done-today stream during a
 * completion, or a project move), and the same event can be imported by two connected calendars.
 * The first is collapsed by task id, the second by identical name + timing. Both would be merged by
 * the interval union anyway; collapsing them keeps the meeting COUNT honest too.
 */
const getMeetingIdentity = (task, interval) =>
    `${trimmed(task.name).toLowerCase()}|${interval.startMs}|${interval.endMs}`

const sumMinutes = intervals =>
    intervals.reduce((total, interval) => total + (interval.endMs - interval.startMs), 0) / MS_PER_MINUTE

/**
 * The figures for one working window at `nowMs`:
 *
 * - `meetingMinutes`, `meetingCount`, `workBlockCount`, `windowMinutes`: the WHOLE working day
 *   (meetings already over still count; "how much of my day is meetings").
 * - `freeMinutes`: time to work that is still AVAILABLE, i.e. the remaining window
 *   [max(now, start), end) minus the union of the meetings inside it, never negative. Free time that
 *   has already passed is gone; an ongoing meeting only takes its rest. Calendar availability, not
 *   time actually spent working.
 * - `remainingWindowMinutes`, `remainingMeetingMinutes`, `remainingFromMs`, `workdayPhase`
 *   ('before' | 'during' | 'after'): the parts of that calculation, for the tooltip and tests.
 *
 * `workBlockCount` is the number of solo work blocks in the window that were left out of the
 * meeting time. Without `nowMs` the whole window counts as remaining (the pre-live behaviour).
 */
export const computeMeetingTime = (tasks, window, nowMs = window.startMs) => {
    const { startMs, endMs } = window
    const windowMinutes = Math.max(0, (endMs - startMs) / MS_PER_MINUTE)

    const seenTaskIds = new Set()
    const seenIdentities = new Set()
    const seenWorkBlockIdentities = new Set()
    const intervals = []

    ;(tasks || []).forEach(task => {
        if (!task) return
        if (task.id) {
            if (seenTaskIds.has(task.id)) return
            seenTaskIds.add(task.id)
        }
        const interval = getMeetingInterval(task)
        if (!interval || interval.endMs <= startMs || interval.startMs >= endMs) return
        const identity = getMeetingIdentity(task, interval)
        // Checked before the duplicate check: when the same event comes from two calendars and only
        // one copy is reliably a solo work block, the other copy still counts as a meeting.
        if (isSoloWorkBlock(task)) {
            seenWorkBlockIdentities.add(identity)
            return
        }
        if (seenIdentities.has(identity)) return
        seenIdentities.add(identity)
        intervals.push(interval)
    })

    const meetingMinutes = Math.min(sumMinutes(mergeIntervalsInWindow(intervals, startMs, endMs)), windowMinutes)

    // Same union, only over what is still ahead of `nowMs`.
    const remaining = getRemainingWindow(window, nowMs)
    const remainingMeetingMinutes = Math.min(
        sumMinutes(mergeIntervalsInWindow(intervals, remaining.startMs, remaining.endMs)),
        remaining.minutes
    )

    return {
        meetingMinutes,
        freeMinutes: Math.max(0, remaining.minutes - remainingMeetingMinutes),
        windowMinutes,
        remainingWindowMinutes: remaining.minutes,
        remainingMeetingMinutes,
        remainingFromMs: remaining.startMs,
        workdayPhase: remaining.phase,
        meetingCount: intervals.length,
        workBlockCount: [...seenWorkBlockIdentities].filter(identity => !seenIdentities.has(identity)).length,
    }
}

/** "2h 30m", "2h", "45m", "0h". Rounded to whole minutes. */
export const formatDurationCompact = minutes => {
    const total = Math.max(0, Math.round(Number(minutes) || 0))
    const hours = Math.floor(total / 60)
    const rest = total % 60
    if (hours > 0 && rest > 0) return `${hours}h ${rest}m`
    if (hours > 0) return `${hours}h`
    if (rest > 0) return `${rest}m`
    return '0h'
}

/** "9:00", "14:05": a local clock time in 24 h form (like the working hours settings). */
export const formatClockTime = ms => moment(ms).format('H:mm')

/** "9–17" for whole hours, "8:30–17" otherwise. */
export const formatWorkingHoursRange = ({ start, end }) => {
    const short = clock => {
        const [hours, minutes] = clock.split(':')
        return minutes === '00' ? String(Number(hours)) : `${Number(hours)}:${minutes}`
    }
    return `${short(start)}–${short(end)}`
}

export const MEETING_TIME_LOADING = 'loading'
export const MEETING_TIME_NO_CALENDAR = 'noCalendar'
export const MEETING_TIME_CALENDAR_LOADING = 'calendarLoading'
export const MEETING_TIME_CALENDAR_UNAVAILABLE = 'calendarUnavailable'
export const MEETING_TIME_READY = 'ready'

/**
 * What the header line shows. Never turns "unknown" into a number:
 *
 * - `settings === undefined`: the working-hours doc has not answered yet → LOADING (render nothing).
 * - no connected calendar → NO_CALENDAR: only the working window is shown, with a connect link.
 *   A meeting total of 0 would claim a verified empty calendar.
 * - a meeting listener failed → CALENDAR_UNAVAILABLE; not all listeners answered → CALENDAR_LOADING.
 * - otherwise READY with the numbers, plus `syncStatus` ('syncing' | 'synced' | 'failed') so the
 *   UI can mark values whose calendar pull is still running or failed.
 */
export const deriveMeetingTimeView = ({
    settings,
    calendarConnected,
    tasksLoaded,
    tasksError,
    syncStatus = null,
    tasks,
    nowMs = Date.now(),
}) => {
    if (settings === undefined) return { status: MEETING_TIME_LOADING }

    const workingHours = resolveWorkingHours(settings)
    const window = getWorkingWindow(workingHours, nowMs)
    const base = { workingHours, windowMinutes: window.minutes }

    if (!calendarConnected) return { ...base, status: MEETING_TIME_NO_CALENDAR }
    if (tasksError) return { ...base, status: MEETING_TIME_CALENDAR_UNAVAILABLE }
    if (!tasksLoaded) return { ...base, status: MEETING_TIME_CALENDAR_LOADING }

    return { ...base, ...computeMeetingTime(tasks, window, nowMs), status: MEETING_TIME_READY, syncStatus }
}
