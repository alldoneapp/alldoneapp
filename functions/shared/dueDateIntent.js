/**
 * Day-level dueDate intent for the server-side task update funnel (AT-2891).
 *
 * Assistant tool calls and MCP clients (Codex, Claude) routinely resend
 * `dueDate: "2026-10-27"` with every progress comment just to keep a task in
 * Today. A date-only value names a DAY, not a moment: when the task is already
 * due on that day in the user's timezone there is nothing to change, so the
 * stored timestamp is kept (including its time of day) and no write or
 * "updated task due" activity is produced. A different day, an overdue task,
 * or any value carrying a time of day is still applied as before.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isDateOnlyDueDate = value => typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())

/**
 * @param {*} currentDueDate - The task's stored dueDate (ms).
 * @param {string} dateOnly - A YYYY-MM-DD string.
 * @param {number} timezoneOffsetMinutes - The user's UTC offset in minutes.
 * @param {Function} moment - moment / moment-timezone.
 * @returns {boolean} true when the stored dueDate falls on that local day.
 */
const isAlreadyDueOnLocalDay = (currentDueDate, dateOnly, timezoneOffsetMinutes, moment) => {
    if (!isDateOnlyDueDate(dateOnly) || typeof moment !== 'function') return false
    const current = Number(currentDueDate)
    // Number.MAX_SAFE_INTEGER is "Someday" and never matches a calendar day.
    if (!Number.isFinite(current) || current <= 0 || current >= Number.MAX_SAFE_INTEGER) return false
    const offset = Number.isFinite(Number(timezoneOffsetMinutes)) ? Number(timezoneOffsetMinutes) : 0
    return moment(current).utcOffset(offset).format('YYYY-MM-DD') === dateOnly.trim()
}

module.exports = { isDateOnlyDueDate, isAlreadyDueOnLocalDay }
