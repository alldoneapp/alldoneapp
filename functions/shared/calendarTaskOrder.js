const moment = require('moment')

/**
 * AT-2351 - server-side mirror of `utils/CalendarTaskOrder.js` (Cloud Functions cannot import app
 * modules, the same reason this folder already mirrors `TASK_PRIORITY_RANK` and the legacy
 * sortIndex normalization). Keep the two in sync; `utils/CalendarTaskOrder.test.js` pins the shared
 * contract by driving both through the same cases.
 *
 * A calendar task always renders at the END of its group, ordered by event start. Nothing about
 * that is stored, so nothing can drift - see the app-side file for the full reasoning on why the
 * rule moved out of `sortIndex`.
 *
 * The server needs it because `FocusTaskService` picks "the task at the top of the list" and must
 * therefore reproduce the list's order. Without this it would hand the user a meeting that is
 * visibly sitting at the bottom of their group. (The deliberate imminent-meeting preference is a
 * separate, explicit rule - see AT-2251.)
 */

const isCalendarTask = task => Boolean(task && task.calendarData)

const getRawStartValue = calendarData => {
    const start = calendarData && calendarData.start
    if (!start) return null
    const raw = start.date || start.dateTime
    return typeof raw === 'string' && raw.length > 0 ? raw : null
}

const isAllDayStart = calendarData => {
    const start = calendarData && calendarData.start
    return Boolean(start && start.date && !start.dateTime)
}

// The event's own calendar day, read as a string prefix rather than parsed: Google/Microsoft emit
// the day in the event's own offset, so the prefix is identical for every reader while a parsed
// timestamp is not (a 9am meeting in UTC+13 parses to the previous UTC day).
const getCalendarStartDayKey = calendarData => {
    const raw = getRawStartValue(calendarData)
    if (raw === null) return null
    const dayMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/)
    return dayMatch ? dayMatch[1] : null
}

const getCalendarStartTimestamp = calendarData => {
    const raw = getRawStartValue(calendarData)
    if (raw === null) return null
    const timestamp = moment(raw).valueOf()
    return Number.isFinite(timestamp) ? timestamp : null
}

const getCalendarOrderKey = calendarData => {
    const dayKey = getCalendarStartDayKey(calendarData)
    if (dayKey === null) return null

    return {
        dayKey,
        // 0 before 1: an all-day event leads the meetings of its own day.
        allDayRank: isAllDayStart(calendarData) ? 0 : 1,
        startTimestamp: getCalendarStartTimestamp(calendarData),
    }
}

const compareCalendarOrderKeys = (keyA, keyB) => {
    if (keyA === null || keyB === null) {
        if (keyA === keyB) return 0
        return keyA === null ? 1 : -1
    }

    if (keyA.dayKey !== keyB.dayKey) return keyA.dayKey < keyB.dayKey ? -1 : 1
    if (keyA.allDayRank !== keyB.allDayRank) return keyA.allDayRank - keyB.allDayRank

    if (keyA.startTimestamp !== null && keyB.startTimestamp !== null) {
        return keyA.startTimestamp - keyB.startTimestamp
    }
    if (keyA.startTimestamp !== keyB.startTimestamp) return keyA.startTimestamp === null ? 1 : -1

    return 0
}

// Use as the FIRST term of a task comparator, ahead of priority. Returns 0 for two non-calendar
// tasks so the caller's existing terms decide those.
const compareTasksByCalendarPlacement = (a, b) => {
    const aIsCalendarTask = isCalendarTask(a)
    const bIsCalendarTask = isCalendarTask(b)

    if (aIsCalendarTask !== bIsCalendarTask) return aIsCalendarTask ? 1 : -1
    if (!aIsCalendarTask) return 0

    return compareCalendarOrderKeys(getCalendarOrderKey(a.calendarData), getCalendarOrderKey(b.calendarData))
}

const orderCalendarTasksLast = (tasks, focusedTaskId = null) => {
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

    calendarEntries.sort((a, b) => compareCalendarOrderKeys(a.orderKey, b.orderKey) || a.index - b.index)

    return nonCalendarTasks.concat(calendarEntries.map(entry => entry.task))
}

module.exports = {
    compareTasksByCalendarPlacement,
    getCalendarOrderKey,
    getCalendarStartDayKey,
    getCalendarStartTimestamp,
    isCalendarTask,
    orderCalendarTasksLast,
}
