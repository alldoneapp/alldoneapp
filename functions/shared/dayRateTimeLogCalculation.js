// Shared by browser backfills and the server repair of historical statistics.
const DEFAULT_DAY_RATE_TARGET_MINUTES = 480
const DEFAULT_DAY_RATE_TRIGGER_TASKS = 5
const isDayRateTimeLogTask = task => task.genericData?.type === 'dayRateTimeLog'

function normalizeDayRateTimeLogConfig(config = {}) {
    const targetMinutes = Number(config.targetMinutes)
    const triggerTasks = Number(config.triggerTasks)

    return {
        enabled: config.enabled === true,
        targetMinutes:
            Number.isFinite(targetMinutes) && targetMinutes > 0 ? targetMinutes : DEFAULT_DAY_RATE_TARGET_MINUTES,
        triggerTasks:
            Number.isFinite(triggerTasks) && triggerTasks > 0
                ? Math.floor(triggerTasks)
                : DEFAULT_DAY_RATE_TRIGGER_TASKS,
    }
}

function getDayRateTaskEstimation(task = {}, openStep = -1) {
    const isAllDayCalendarTask = Boolean(task.calendarData?.start?.date && !task.calendarData?.start?.dateTime)
    if (isAllDayCalendarTask) return 0

    const estimations = task.estimations || {}
    const estimation =
        estimations[openStep] ??
        estimations[String(openStep)] ??
        estimations['-1'] ??
        estimations.Open ??
        estimations.open ??
        0
    const numericEstimation = Number(estimation)

    return Number.isFinite(numericEstimation) ? numericEstimation : 0
}

function calculateDayRateTimeLogAdjustment(tasks = [], config = {}, forceWorkedDay = false, openStep = -1) {
    const normalizedConfig = normalizeDayRateTimeLogConfig(config)
    const realDoneTasks = tasks.filter(task => !task.parentId && !isDayRateTimeLogTask(task))
    const realLoggedMinutes = realDoneTasks.reduce((total, task) => total + getDayRateTaskEstimation(task, openStep), 0)
    const hasManualNonCalendarLoggedTime = realDoneTasks.some(
        task => !task.calendarData && getDayRateTaskEstimation(task, openStep) > 0
    )
    const shouldLogDay =
        forceWorkedDay || (!hasManualNonCalendarLoggedTime && realDoneTasks.length >= normalizedConfig.triggerTasks)
    // A day-rate project bills the day, not the minutes, so the target is a ceiling as well as a
    // floor — but only for CALENDAR time. Overlapping or long events (a workshop, travel, a
    // dinner) are what inflate a day past the target, so calendar time can fill a day only up to
    // it. Time typed onto a non-calendar task is the user's explicit record of the day and is
    // always kept: ten hours logged by hand stay ten hours, and the ceiling rises to meet them.
    // Unlike the top-up, the cap does not wait for the task trigger or a manual "worked day".
    const manualNonCalendarMinutes = realDoneTasks
        .filter(task => !task.calendarData)
        .reduce((total, task) => total + getDayRateTaskEstimation(task, openStep), 0)
    const dayCeilingMinutes = Math.max(normalizedConfig.targetMinutes, manualNonCalendarMinutes)
    const excessMinutes = Math.max(0, realLoggedMinutes - dayCeilingMinutes)
    const shouldCapDay = excessMinutes > 0

    return {
        adjustmentMinutes: shouldLogDay ? Math.max(0, normalizedConfig.targetMinutes - realLoggedMinutes) : 0,
        manualNonCalendarMinutes,
        dayCeilingMinutes,
        excessMinutes,
        realDoneTasksAmount: realDoneTasks.length,
        realLoggedMinutes,
        hasManualNonCalendarLoggedTime,
        shouldLogDay,
        shouldCapDay,
        // Pinned means "the day's statistics end at the target whatever the tasks add up to".
        shouldPinDay: shouldLogDay || shouldCapDay,
    }
}

module.exports = { normalizeDayRateTimeLogConfig, getDayRateTaskEstimation, calculateDayRateTimeLogAdjustment }
