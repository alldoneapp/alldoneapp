import moment from 'moment'

import { MEETING_ATTENDANCE_NOT_ATTENDED } from '../../functions/shared/meetingReview/meetingReviewConstants'
import { isSoloWorkBlock, mergeIntervalsInWindow } from '../meetingTimeToday'

/**
 * AT-3145 (follow-up, 2026-11-24) — "meeting-free work time per day" in Settings → Meeting time.
 *
 * Pure maths over the entries of `buildMeetingStatsEntries` and the local day starts of the
 * statistics period; no Firestore, no React (`meetingFreeWorkTime.test.js`).
 *
 * What the number is: CALENDAR-DERIVED time without appointments inside the working window,
 *
 *     free = working window − union(meetings clipped to the window)
 *
 * It is availability according to the calendar, NOT measured or productive working time.
 *
 * Rules, aligned with "Time to work" (`utils/meetingTimeToday.js`, AT-3136) and decided with the
 * user on 2026-11-24:
 *
 * - Working window: the one "Time to work" uses (`users/{uid}/bookingSettings/default`, edited in
 *   Settings → Customizations). There is no history of that setting, so the CURRENT hours apply to
 *   past days too; the UI says so.
 * - Workdays: the existing "Include weekends" switch of the same settings (default off). Without it
 *   Saturday and Sunday have no working window and are left out of the totals.
 * - Meetings are merged (union), clipped to the window, so overlapping meetings and the same event
 *   from two calendars never count twice.
 * - Not busy: all-day, cancelled, declined, unreadable (`excludedReason`), timed events spanning
 *   several days (like the availability engine), reliably solo work blocks (`isSoloWorkBlock`: they
 *   ARE time to work), and appointments the user marked "not attended" in the meeting review.
 * - A user-adjusted duration (meeting review) replaces the planned one.
 * - Past appointments that were not checked off still occupied the calendar and count.
 * - ALWAYS GLOBAL: the free time subtracts every own appointment of every project. With a project
 *   scope only `scopedMeetingMs` (time in which at least one appointment of that project ran) is
 *   added; the free time itself never pretends that other projects' meetings did not exist.
 * - Days: a day whose window has ended is "complete" and counts in the totals; today ("today") is
 *   shown from the calendar but left out of the totals; future days get no values.
 * - No invented history: a workday with no calendar entry at all (not even an all-day or excluded
 *   one) counts as free but is flagged `noCalendarEntries`, because the calendar sync only keeps
 *   what it imported on the day (it reads from "today" on); such a day may simply never have been
 *   synced.
 */

export const FREE_DAY_COMPLETE = 'complete'
export const FREE_DAY_TODAY = 'today'
export const FREE_DAY_FUTURE = 'future'
export const FREE_DAY_NON_WORKDAY = 'non_workday'

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

const clockParts = clock => clock.split(':').map(Number)

/** The saved "Include weekends" switch of the working-hours settings; off when never saved. */
export const resolveIncludeWeekends = settings => settings?.includeWeekends === true

/**
 * The working window of the local day that starts at `dayStartMs`. Wall-clock times are set
 * directly (not added as minutes to midnight), so 9:00 stays 9:00 on DST change days.
 */
export const getWorkingWindowForDay = ({ start, end }, dayStartMs) => {
    const day = moment(dayStartMs).startOf('day')
    const [startHours, startMinutes] = clockParts(start)
    const [endHours, endMinutes] = clockParts(end)
    const startMs = day.clone().hours(startHours).minutes(startMinutes).valueOf()
    const endMs = day.clone().hours(endHours).minutes(endMinutes).valueOf()
    return { startMs, endMs: Math.max(startMs, endMs) }
}

export const isWorkday = (dayStartMs, includeWeekends) => includeWeekends || moment(dayStartMs).isoWeekday() < 6

/** Timed event that runs over several calendar days: not busy time, as in "Time to work". */
const spansSeveralDays = entry => {
    const calendarData = entry.task?.calendarData || {}
    const startRaw = typeof calendarData.start?.dateTime === 'string' ? calendarData.start.dateTime.trim() : ''
    const endRaw = typeof calendarData.end?.dateTime === 'string' ? calendarData.end.dateTime.trim() : ''
    if (startRaw && endRaw) return startRaw.substring(0, 10) !== endRaw.substring(0, 10)
    // Numeric bounds only: compare the local days (an end at exactly midnight belongs to the day before).
    return moment(entry.startMs).format('YYYY-MM-DD') !== moment(entry.endMs - 1).format('YYYY-MM-DD')
}

/**
 * Why an entry occupies no working time, or null when it does. `solo_work_block` entries are
 * counted separately (they are work time).
 */
export const getFreeTimeExclusion = entry => {
    if (!entry) return 'invalid'
    if (entry.excludedReason) return entry.excludedReason
    if (!isFiniteNumber(entry.startMs) || !isFiniteNumber(entry.endMs) || !(entry.endMs > entry.startMs))
        return 'invalid'
    if (entry.attendance === MEETING_ATTENDANCE_NOT_ATTENDED) return 'not_attended'
    if (entry.soloWorkBlock === true || (entry.soloWorkBlock === undefined && isSoloWorkBlock(entry.task)))
        return 'solo_work_block'
    if (spansSeveralDays(entry)) return 'multi_day'
    return null
}

/** The busy interval of an entry: the adjusted duration from the review wins over the planned one. */
const getBusyInterval = entry => {
    const { actualStartMs, actualEndMs } = entry
    if (isFiniteNumber(actualStartMs) && isFiniteNumber(actualEndMs) && actualEndMs > actualStartMs) {
        return { startMs: actualStartMs, endMs: actualEndMs }
    }
    return { startMs: entry.startMs, endMs: entry.endMs }
}

const sumMs = intervals => intervals.reduce((total, interval) => total + (interval.endMs - interval.startMs), 0)

const overlaps = (interval, fromMs, toMs) => interval.startMs < toMs && interval.endMs > fromMs

/**
 * @param {object} params
 * @param {Array<object>} params.entries from `buildMeetingStatsEntries` (deduplicated, all projects)
 * @param {{start:string,end:string}} params.workingHours from `resolveWorkingHours`
 * @param {boolean} params.includeWeekends from `resolveIncludeWeekends`
 * @param {number[]} params.dayStartsMs local day starts of the period
 * @param {number} params.rangeEndMs exclusive end of the period
 * @param {number} params.nowMs
 * @param {string|null} [params.projectId] adds `scopedMeetingMs`; the free time stays global
 */
export const computeMeetingFreeWorkTime = ({
    entries = [],
    workingHours,
    includeWeekends = false,
    dayStartsMs = [],
    rangeEndMs,
    nowMs = Date.now(),
    projectId = null,
}) => {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : []
    const busy = []
    const soloBlocks = []
    const anyEntries = []
    list.forEach(entry => {
        if (isFiniteNumber(entry.startMs) && isFiniteNumber(entry.endMs)) {
            anyEntries.push({ startMs: entry.startMs, endMs: Math.max(entry.endMs, entry.startMs + 1) })
        }
        const exclusion = getFreeTimeExclusion(entry)
        if (exclusion === 'solo_work_block') soloBlocks.push(getBusyInterval(entry))
        if (exclusion) return
        busy.push({ ...getBusyInterval(entry), projectId: entry.projectId || '' })
    })

    const starts = (Array.isArray(dayStartsMs) ? dayStartsMs : []).filter(isFiniteNumber).sort((a, b) => a - b)
    const days = starts.map((dayStartMs, index) => {
        const dayEndMs = index + 1 < starts.length ? starts[index + 1] : rangeEndMs
        const hasCalendarEntries = anyEntries.some(interval => overlaps(interval, dayStartMs, dayEndMs))
        const base = { dayStartMs, hasCalendarEntries, noCalendarEntries: false }

        if (!isWorkday(dayStartMs, includeWeekends)) {
            return {
                ...base,
                status: FREE_DAY_NON_WORKDAY,
                workday: false,
                windowStartMs: null,
                windowEndMs: null,
                windowMs: 0,
                meetingMs: null,
                freeMs: null,
                scopedMeetingMs: null,
                meetingIntervals: [],
                meetingCount: 0,
                soloBlockCount: 0,
            }
        }

        const window = getWorkingWindowForDay(workingHours, dayStartMs)
        const windowMs = window.endMs - window.startMs
        let status = FREE_DAY_FUTURE
        if (window.endMs <= nowMs) status = FREE_DAY_COMPLETE
        else if (dayStartMs <= nowMs) status = FREE_DAY_TODAY
        const common = {
            ...base,
            status,
            workday: true,
            windowStartMs: window.startMs,
            windowEndMs: window.endMs,
            windowMs,
        }

        if (status === FREE_DAY_FUTURE) {
            return {
                ...common,
                meetingMs: null,
                freeMs: null,
                scopedMeetingMs: null,
                meetingIntervals: [],
                meetingCount: 0,
                soloBlockCount: 0,
            }
        }

        const merged = mergeIntervalsInWindow(busy, window.startMs, window.endMs)
        const meetingMs = Math.min(sumMs(merged), windowMs)
        const scopedMeetingMs = projectId
            ? sumMs(
                  mergeIntervalsInWindow(
                      busy.filter(interval => interval.projectId === projectId),
                      window.startMs,
                      window.endMs
                  )
              )
            : null
        return {
            ...common,
            noCalendarEntries: !hasCalendarEntries,
            meetingMs,
            freeMs: Math.max(0, windowMs - meetingMs),
            scopedMeetingMs,
            meetingIntervals: merged,
            meetingCount: busy.filter(interval => overlaps(interval, window.startMs, window.endMs)).length,
            soloBlockCount: soloBlocks.filter(interval => overlaps(interval, window.startMs, window.endMs)).length,
        }
    })

    const completeDays = days.filter(day => day.status === FREE_DAY_COMPLETE)
    const windowMs = completeDays.reduce((sum, day) => sum + day.windowMs, 0)
    const meetingMs = completeDays.reduce((sum, day) => sum + day.meetingMs, 0)
    const freeMs = completeDays.reduce((sum, day) => sum + day.freeMs, 0)
    const scopedMeetingMs = projectId ? completeDays.reduce((sum, day) => sum + day.scopedMeetingMs, 0) : null

    return {
        days,
        projectId: projectId || null,
        summary: {
            completeWorkdays: completeDays.length,
            windowMs,
            meetingMs,
            freeMs,
            scopedMeetingMs,
            averageFreeMs: completeDays.length > 0 ? freeMs / completeDays.length : null,
            averageMeetingMs: completeDays.length > 0 ? meetingMs / completeDays.length : null,
            freeShare: windowMs > 0 ? freeMs / windowMs : null,
            noCalendarEntryDays: completeDays.filter(day => day.noCalendarEntries).length,
            hasToday: days.some(day => day.status === FREE_DAY_TODAY),
            maxWindowMs: days.reduce((max, day) => Math.max(max, day.windowMs || 0), 0),
        },
    }
}
