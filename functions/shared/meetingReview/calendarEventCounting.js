'use strict'

/**
 * AT-3137 — the counting rules for "time in calendar appointments", defined ONCE.
 *
 * Concept 4.2/4.6 (E10): the meeting statistics and AT-3136's "meetings in working time" line must
 * not disagree about what a counted appointment is. These helpers are pure and have no app or
 * Admin SDK dependency, so either side can import them:
 *
 *   - all-day events never count (they are availability markers: holidays, birthdays)
 *   - cancelled events and events the user declined never count (the sync drops most of them
 *     already, `filterEvents` in functions/GoogleCalendarTasks/calendarTasks.js; these checks
 *     cover tasks that were stored before the status changed)
 *   - one appointment is counted once: the same event id, and the same title at the same time in
 *     two connected calendars, collapse to one entry
 *   - a moment of wall-clock time is counted at most once (see `splitOverlaps` in
 *     meetingTimeStats.js)
 *
 * Event bounds come from the numeric `calendarData.startMs/endMs` the sync writes since AT-3137;
 * tasks synced before that only carry the provider's ISO strings, which are parsed instead.
 */

const MEETING_EXCLUSION_ALL_DAY = 'all_day'
const MEETING_EXCLUSION_CANCELLED = 'cancelled'
const MEETING_EXCLUSION_DECLINED = 'declined'
const MEETING_EXCLUSION_INVALID = 'invalid'

const toFiniteNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// Microsoft Graph values are requested in UTC but carry no offset ("2026-11-24T08:00:00.0000000",
// timeZone "UTC"); Date.parse would read those as the BROWSER's local time.
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i
const parseProviderDateTime = (value, timeZone) => {
    if (typeof value !== 'string' || !value) return null
    const isDateTime = value.includes('T')
    const normalized = isDateTime && !HAS_OFFSET.test(value) && timeZone === 'UTC' ? `${value}Z` : value
    const parsed = Date.parse(normalized)
    return Number.isFinite(parsed) ? parsed : null
}

const isAllDayCalendarData = calendarData => {
    if (!calendarData || typeof calendarData !== 'object') return false
    if (calendarData.isAllDay === true) return true
    const start = calendarData.start || {}
    return !!start.date && !start.dateTime
}

/**
 * @returns {{startMs:number,endMs:number,isAllDay:boolean}|null} null when the bounds cannot be read
 */
const getCalendarEventBounds = calendarData => {
    if (!calendarData || typeof calendarData !== 'object') return null
    const isAllDay = isAllDayCalendarData(calendarData)
    let startMs = toFiniteNumber(calendarData.startMs)
    let endMs = toFiniteNumber(calendarData.endMs)
    if (startMs === null) {
        startMs = parseProviderDateTime(
            calendarData.start?.dateTime || calendarData.start?.date,
            calendarData.start?.timeZone
        )
    }
    if (endMs === null) {
        endMs = parseProviderDateTime(calendarData.end?.dateTime || calendarData.end?.date, calendarData.end?.timeZone)
    }
    if (startMs === null || endMs === null) return null
    return { startMs, endMs, isAllDay }
}

/**
 * Why a calendar task does not count at all, or null when it counts.
 */
const getCalendarEventExclusionReason = task => {
    const calendarData = task?.calendarData
    if (!calendarData || typeof calendarData !== 'object') return MEETING_EXCLUSION_INVALID
    if (isAllDayCalendarData(calendarData)) return MEETING_EXCLUSION_ALL_DAY
    if (calendarData.status === 'cancelled') return MEETING_EXCLUSION_CANCELLED
    if (calendarData.selfResponseStatus === 'declined') return MEETING_EXCLUSION_DECLINED
    const bounds = getCalendarEventBounds(calendarData)
    if (!bounds || !(bounds.endMs > bounds.startMs)) return MEETING_EXCLUSION_INVALID
    return null
}

const normalizeTitleForDedupe = value =>
    String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

/**
 * Drops duplicates of the same appointment, keeping the first occurrence in input order (callers
 * put the entry they prefer, e.g. the one with a review, first).
 *
 * Same id → same event. Same normalized title with identical start and end → the same invitation
 * synced from two connected calendars (each provider account has its own event id for it).
 */
const dedupeCalendarTasks = (tasks = [], getBounds = task => getCalendarEventBounds(task?.calendarData)) => {
    const seenIds = new Set()
    const seenSlots = new Set()
    const result = []
    ;(Array.isArray(tasks) ? tasks : []).forEach(task => {
        if (!task) return
        if (task.id) {
            if (seenIds.has(task.id)) return
            seenIds.add(task.id)
        }
        const bounds = getBounds(task)
        const title = normalizeTitleForDedupe(task.name || task.extendedName)
        if (bounds && title) {
            const slotKey = `${title}\u0000${bounds.startMs}\u0000${bounds.endMs}`
            if (seenSlots.has(slotKey)) return
            seenSlots.add(slotKey)
        }
        result.push(task)
    })
    return result
}

module.exports = {
    MEETING_EXCLUSION_ALL_DAY,
    MEETING_EXCLUSION_CANCELLED,
    MEETING_EXCLUSION_DECLINED,
    MEETING_EXCLUSION_INVALID,
    getCalendarEventBounds,
    getCalendarEventExclusionReason,
    isAllDayCalendarData,
    dedupeCalendarTasks,
    normalizeTitleForDedupe,
}
