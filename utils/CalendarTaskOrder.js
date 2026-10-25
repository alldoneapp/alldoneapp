/**
 * AT-2351 — where a calendar task sits in its group, decided at DISPLAY time.
 *
 * A calendar task always renders at the END of its group, and the calendar tasks among themselves
 * are ordered by when their event starts. That is a rendering rule, not a property of the document:
 * nothing is stored, so nothing can drift.
 *
 * ## Why this replaces the stored-`sortIndex` approach (AT-2259 → AT-2270 → here)
 *
 * Both earlier attempts encoded the placement INTO `sortIndex`, the single key every group orders
 * by. AT-2259 stored the event start there; AT-2270 stored `-1e14 - eventStart`, a reserved band
 * below every generated index. Both worked in isolation and both decayed in production, for the
 * same structural reason: `sortIndex` means "where the user put this in the list", it is legitimately
 * rewritten by ~25 unrelated code paths, and a rule that lives in a field those paths own cannot
 * survive them.
 *
 *   - `generateSortIndex()` is written on postpone, send-to-backlog, assignee change, project move,
 *     goal change, recurrence change, promote-subtask, all three workflow moves, un-complete, the
 *     goal-postpone cascade, auto-postpone and kick-user cleanup. Every one of those silently
 *     ejected a meeting from the band, and AT-2270 read that as "the user placed this here" and
 *     never re-sorted it again. Postponing a meeting to tomorrow was enough to break its placement
 *     permanently.
 *   - Recognising "has the user moved this?" from the stored number needed a heuristic over three
 *     historical value shapes, with millisecond tolerances and whole-minute alignment tests. A
 *     heuristic that is wrong in either direction is invisible: it either strands a meeting in the
 *     middle of the list or overrides a placement the user made on purpose.
 *   - `sortTasksByPriority` runs AFTER the `sortIndex` ordering, so any calendar task carrying a
 *     priority was lifted straight back out of the band regardless of what it stored.
 *
 * Deciding it at render time removes the state instead of re-encoding it. There is no value for a
 * write path to clobber, no legacy shape to recognise, and no way for a view to disagree with
 * another — every grouped list funnels through `sortTasksByPriority`, and this is its last stage.
 *
 * ## The rule
 *
 * 1. Non-calendar tasks keep the order they arrived in (sortIndex desc, then priority). Untouched.
 * 2. Calendar tasks move to the end, ordered by event start ascending — earliest meeting first.
 * 3. The currently focused task is exempt and keeps the position the caller gave it (the top).
 *    Focus is an explicit "I am working on this now" and outranks the calendar block.
 *
 * Ordering inside the calendar block is `(calendar day, all-day first, start time, arrival)`:
 *
 *   - The DAY is compared as the `YYYY-MM-DD` prefix of the raw calendar value, never as a parsed
 *     timestamp. Both Google and Microsoft return the event's own local day, so the prefix is the
 *     day the user sees on their calendar — independent of the reader's timezone, which a parsed
 *     value is not. A 9am meeting in UTC+13 parses to the PREVIOUS UTC day, so comparing timestamps
 *     alone would sort it above that day's all-day event for some readers and below it for others.
 *   - All-day events lead their day. They have no time to sort by and they span the whole day, so
 *     they read as the day's header rather than as something wedged between two meetings.
 *   - Ties fall back to arrival order, so the sort is stable and deterministic: two meetings that
 *     genuinely start at the same moment never swap places between renders.
 *   - A calendar task with no usable start (a malformed or missing `calendarData.start`) sorts last
 *     within the block, in arrival order. It is still a calendar task, so it still belongs at the
 *     end of the group; it simply has nothing to be chronological about.
 */

import moment from 'moment'

/**
 * The one definition of "this is a calendar task". Presence of `calendarData` is what every other
 * call site in the app already keys on (`TaskItemTags`, `myDayOpenTasksIntervals`, the edit guards);
 * this just gives it a name.
 */
export const isCalendarTask = task => Boolean(task && task.calendarData)

const getRawStartValue = calendarData => {
    const start = calendarData && calendarData.start
    if (!start) return null
    // All-day events carry `date` only; timed events carry `dateTime`. Reading `date` first keeps an
    // event that somehow has both classified as all-day, matching `isAllDayCalendarEvent`.
    const raw = start.date || start.dateTime
    return typeof raw === 'string' && raw.length > 0 ? raw : null
}

const isAllDayStart = calendarData => {
    const start = calendarData && calendarData.start
    return Boolean(start && start.date && !start.dateTime)
}

/**
 * The event's own calendar day as `YYYY-MM-DD`, taken from the string prefix rather than by parsing.
 * Google/Microsoft both emit ISO-style values in the event's own offset, so the prefix is the day
 * shown on the user's calendar and is identical for every reader. Mirrors `getCalendarStartDay` in
 * `functions/GoogleCalendarTasks/calendarTasks.js`, which relies on the same guarantee.
 */
export const getCalendarStartDayKey = calendarData => {
    const raw = getRawStartValue(calendarData)
    if (raw === null) return null
    const dayMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/)
    return dayMatch ? dayMatch[1] : null
}

/**
 * The event start as an absolute timestamp, used only to order timed events WITHIN one calendar
 * day. Null when there is no usable start.
 */
export const getCalendarStartTimestamp = calendarData => {
    const raw = getRawStartValue(calendarData)
    if (raw === null) return null
    const timestamp = moment(raw).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * The full ordering key for one calendar task, or null when the event start is unusable (which
 * sorts the task to the end of the calendar block).
 */
export const getCalendarOrderKey = calendarData => {
    const dayKey = getCalendarStartDayKey(calendarData)
    if (dayKey === null) return null

    return {
        dayKey,
        // 0 before 1: an all-day event leads the meetings of its own day.
        allDayRank: isAllDayStart(calendarData) ? 0 : 1,
        // An all-day event has no time of day; the day key already placed it.
        startTimestamp: getCalendarStartTimestamp(calendarData),
    }
}

/**
 * Compare two calendar ordering keys. Returns 0 when they are indistinguishable, leaving the
 * tiebreak to the caller (arrival order for the list, `sortIndex` for the flat comparators).
 */
const compareCalendarOrderKeys = (keyA, keyB) => {
    // No usable start: last within the block.
    if (keyA === null || keyB === null) {
        if (keyA === keyB) return 0
        return keyA === null ? 1 : -1
    }

    if (keyA.dayKey !== keyB.dayKey) return keyA.dayKey < keyB.dayKey ? -1 : 1
    if (keyA.allDayRank !== keyB.allDayRank) return keyA.allDayRank - keyB.allDayRank

    // Same day, both timed (two all-day events on the same day have nothing left to compare).
    if (keyA.startTimestamp !== null && keyB.startTimestamp !== null) {
        return keyA.startTimestamp - keyB.startTimestamp
    }
    if (keyA.startTimestamp !== keyB.startTimestamp) return keyA.startTimestamp === null ? 1 : -1

    return 0
}

const compareCalendarEntries = (a, b) => {
    // Equal keys keep arrival order, so the result is stable across renders.
    return compareCalendarOrderKeys(a.orderKey, b.orderKey) || a.index - b.index
}

/**
 * The same rule as a standalone comparator term, for the flat sorts that reproduce display order
 * without going through `sortTasksByPriority` — the focus-selection comparators on both the client
 * (`sortTasksByDisplayOrder`) and the server (`FocusTaskService`). Those pick "the task at the top
 * of the list", so they have to agree with the list or the app focuses a meeting the user can see
 * sitting at the bottom.
 *
 * Use it as the FIRST term, ahead of priority, exactly as the rendered order applies it last.
 * Returns 0 for two non-calendar tasks, so the caller's existing terms decide those.
 */
export const compareTasksByCalendarPlacement = (a, b) => {
    const aIsCalendarTask = isCalendarTask(a)
    const bIsCalendarTask = isCalendarTask(b)

    if (aIsCalendarTask !== bIsCalendarTask) return aIsCalendarTask ? 1 : -1
    if (!aIsCalendarTask) return 0

    return compareCalendarOrderKeys(getCalendarOrderKey(a.calendarData), getCalendarOrderKey(b.calendarData))
}

/**
 * Move every calendar task to the end of `tasks`, ordered by event start. Non-calendar tasks keep
 * their incoming relative order exactly. `focusedTaskId`, when given, is exempt and stays where the
 * caller put it.
 *
 * Pure and allocation-only — safe to call on every render.
 */
export const orderCalendarTasksLast = (tasks, focusedTaskId = null) => {
    if (!Array.isArray(tasks)) return []

    const nonCalendarTasks = []
    const calendarEntries = []

    tasks.forEach((task, index) => {
        const isExemptFocusTask = Boolean(focusedTaskId) && task && task.id === focusedTaskId
        if (isCalendarTask(task) && !isExemptFocusTask) {
            calendarEntries.push({ task, index, orderKey: getCalendarOrderKey(task.calendarData) })
        } else {
            nonCalendarTasks.push(task)
        }
    })

    if (calendarEntries.length === 0) return nonCalendarTasks

    calendarEntries.sort(compareCalendarEntries)

    return nonCalendarTasks.concat(calendarEntries.map(entry => entry.task))
}
