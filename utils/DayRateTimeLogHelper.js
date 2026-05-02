import moment from 'moment-timezone'

import { BatchWrapper } from '../functions/BatchWrapper/batchWrapper'
import {
    DONE_STEP,
    OPEN_STEP,
    RECURRENCE_NEVER,
    TASK_ASSIGNEE_USER_TYPE,
} from '../components/TaskListView/Utils/TasksHelper'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import store from '../redux/store'
import { generateSortIndex, getDb, updateStatistics } from './backends/firestore'

export const DAY_RATE_TIME_LOG_TASK_NAME = 'Time log for day rate'
export const DAY_RATE_TIME_LOG_TYPE = 'dayRateTimeLog'
export const DEFAULT_DAY_RATE_TARGET_MINUTES = 480
export const DEFAULT_DAY_RATE_TRIGGER_TASKS = 5
export const DAY_RATE_BACKFILL_VERSION = 2
const DAY_RATE_BACKFILL_CURSOR_FIELD = 'backfilledUntilByUser'
const DAY_RATE_BACKFILL_VERSION_FIELD = 'backfillVersionByUser'
const DAY_RATE_LOG_PREFIX = '[day-rate-time-log]'

function logDayRateTimeLog(event, data = {}) {
    const safeData = JSON.stringify(data, (key, value) => {
        if (value instanceof Error) {
            return {
                message: value.message,
                stack: value.stack,
            }
        }
        return value
    })
    console.log(`${DAY_RATE_LOG_PREFIX} ${event} ${safeData}`)
}

export function normalizeDayRateTimeLogConfig(config = {}) {
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

export function isDayRateTimeLogTask(task = {}) {
    return task.genericData?.type === DAY_RATE_TIME_LOG_TYPE
}

export function normalizeDayRateTimezoneOffset(value) {
    if (value === null || value === undefined || value === '') return null

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null
        return Math.abs(value) <= 16 ? value * 60 : value
    }

    if (typeof value !== 'string') return null

    const trimmedValue = value.trim()
    const numericValue = Number(trimmedValue)
    if (Number.isFinite(numericValue)) return normalizeDayRateTimezoneOffset(numericValue)

    const offsetMatch = trimmedValue.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i)
    if (!offsetMatch) return null

    const sign = offsetMatch[1] === '-' ? -1 : 1
    const hours = Number(offsetMatch[2])
    const minutes = Number(offsetMatch[3] || 0)
    return sign * (hours * 60 + minutes)
}

export function getDayRateTimezone(timezone) {
    if (timezone !== undefined && timezone !== null && timezone !== '') return timezone

    const loggedUser = store.getState().loggedUser || {}
    const storedTimezoneName = loggedUser.timezoneName || loggedUser.preferredTimezone || loggedUser.timeZone
    if (storedTimezoneName && moment.tz.zone(storedTimezoneName)) return storedTimezoneName

    const detectedTimezone = moment.tz.guess()
    if (detectedTimezone) return detectedTimezone

    return loggedUser.timezone ?? loggedUser.timezoneOffset ?? loggedUser.timezoneMinutes ?? null
}

function getDayRateMoment(timestamp, timezone) {
    const resolvedTimezone = getDayRateTimezone(timezone)

    if (typeof resolvedTimezone === 'string' && moment.tz.zone(resolvedTimezone)) {
        return moment(timestamp).tz(resolvedTimezone)
    }

    const timezoneOffset = normalizeDayRateTimezoneOffset(resolvedTimezone)
    return timezoneOffset !== null ? moment(timestamp).utcOffset(timezoneOffset) : moment(timestamp)
}

function formatDayRateTimestamp(timestamp, timezone) {
    if (!timestamp) return null

    const timestampMoment = getDayRateMoment(timestamp, timezone)
    return {
        timestamp,
        iso: moment(timestamp).toISOString(),
        local: timestampMoment.format('YYYY-MM-DD HH:mm:ss Z'),
        dayKey: timestampMoment.format('YYYYMMDD'),
    }
}

export function getDayRateTimeLogRange(timestamp, timezone) {
    const day = getDayRateMoment(timestamp, timezone)
    return {
        start: day.clone().startOf('day').valueOf(),
        end: day.clone().endOf('day').valueOf(),
        dayKey: day.format('YYYYMMDD'),
    }
}

export function getDayRateTaskEstimation(task = {}) {
    const estimations = task.estimations || {}
    const estimation =
        estimations[OPEN_STEP] ??
        estimations[String(OPEN_STEP)] ??
        estimations['-1'] ??
        estimations.Open ??
        estimations.open ??
        0
    const numericEstimation = Number(estimation)

    return Number.isFinite(numericEstimation) ? numericEstimation : 0
}

function getDayRateTaskLogSummary(task = {}, timezone) {
    return {
        id: task.id,
        userId: task.userId,
        done: task.done,
        inDone: task.inDone,
        parentId: task.parentId || null,
        generated: isDayRateTimeLogTask(task),
        calendar: !!task.calendarData,
        estimation: getDayRateTaskEstimation(task),
        completed: formatDayRateTimestamp(task.completed, timezone),
    }
}

async function getDayRateStatisticsForDay(projectId, userId, timestamp, timezone) {
    const day = getDayRateMoment(timestamp, timezone)
    const dateKey = day.format('DDMMYYYY')
    const docPath = `statistics/${projectId}/${userId}/${dateKey}`
    const doc = await getDb().doc(docPath).get()
    const data = doc.exists === false ? null : doc.data?.()
    const doneTime = Number(data?.doneTime || 0)

    const statistics = {
        docPath,
        dateKey,
        exists: !!data,
        doneTime: Number.isFinite(doneTime) ? doneTime : 0,
        timestamp: data?.timestamp || null,
        day: data?.day || null,
    }

    logDayRateTimeLog('stats-day-result', {
        projectId,
        userId,
        day: formatDayRateTimestamp(timestamp, timezone),
        statistics,
    })

    return statistics
}

export function calculateDayRateTimeLogAdjustment(tasks = [], config = {}, forceWorkedDay = false) {
    const normalizedConfig = normalizeDayRateTimeLogConfig(config)
    const realDoneTasks = tasks.filter(task => !task.parentId && !isDayRateTimeLogTask(task))
    const realLoggedMinutes = realDoneTasks.reduce((total, task) => total + getDayRateTaskEstimation(task), 0)
    const hasManualNonCalendarLoggedTime = realDoneTasks.some(
        task => !task.calendarData && getDayRateTaskEstimation(task) > 0
    )
    const shouldLogDay =
        forceWorkedDay || (!hasManualNonCalendarLoggedTime && realDoneTasks.length >= normalizedConfig.triggerTasks)

    return {
        adjustmentMinutes: shouldLogDay ? Math.max(0, normalizedConfig.targetMinutes - realLoggedMinutes) : 0,
        realDoneTasksAmount: realDoneTasks.length,
        realLoggedMinutes,
        hasManualNonCalendarLoggedTime,
        shouldLogDay,
    }
}

async function getDoneTasksForDay(projectId, userId, timestamp, timezone) {
    const { start, end } = getDayRateTimeLogRange(timestamp, timezone)
    logDayRateTimeLog('fetch-day-start', {
        projectId,
        userId,
        day: formatDayRateTimestamp(timestamp, timezone),
        start: formatDayRateTimestamp(start, timezone),
        end: formatDayRateTimestamp(end, timezone),
    })

    const snapshot = await getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('inDone', '==', true)
        .where('completed', '>=', start)
        .where('completed', '<=', end)
        .orderBy('completed', 'desc')
        .get()

    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(task => task.done === true)

    logDayRateTimeLog('fetch-day-result', {
        projectId,
        userId,
        day: formatDayRateTimestamp(timestamp, timezone),
        docsAmount: snapshot.docs.length,
        doneTasksAmount: tasks.length,
        generatedTasksAmount: tasks.filter(isDayRateTimeLogTask).length,
        tasks: tasks.map(task => getDayRateTaskLogSummary(task, timezone)),
    })

    return tasks
}

async function getDoneTasksForRange(projectId, userId, start, end) {
    const snapshot = await getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('inDone', '==', true)
        .where('completed', '>=', start)
        .where('completed', '<=', end)
        .orderBy('completed', 'desc')
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(task => task.done === true)
}

function buildDayRateTimeLogTask(projectId, userId, completed, adjustmentMinutes, manual, timezone) {
    const now = Date.now()
    const { loggedUser } = store.getState()
    const dayKey = getDayRateTimeLogRange(completed, timezone).dayKey
    const safeUserId = String(userId).replace(/\//g, '_')
    const taskId = `${DAY_RATE_TIME_LOG_TYPE}_${safeUserId}_${dayKey}`

    return {
        id: taskId,
        name: DAY_RATE_TIME_LOG_TASK_NAME,
        extendedName: DAY_RATE_TIME_LOG_TASK_NAME,
        description: '',
        userId,
        userIds: [userId],
        currentReviewerId: DONE_STEP,
        observersIds: [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        stepHistory: [OPEN_STEP],
        hasStar: '#FFFFFF',
        created: now,
        creatorId: loggedUser.uid || userId,
        dueDate: completed,
        completed,
        done: true,
        inDone: true,
        isPrivate: true,
        isPublicFor: [userId],
        parentId: null,
        isSubtask: false,
        subtaskIds: [],
        subtaskNames: [],
        recurrence: RECURRENCE_NEVER,
        lastEditorId: loggedUser.uid || userId,
        lastEditionDate: now,
        linkBack: '',
        estimations: { [OPEN_STEP]: adjustmentMinutes },
        comments: [],
        genericData: {
            type: DAY_RATE_TIME_LOG_TYPE,
            projectId,
            day: dayKey,
            manual: manual === true,
        },
        sortIndex: generateSortIndex(),
        linkedParentNotesIds: [],
        linkedParentTasksIds: [],
        linkedParentContactsIds: [],
        linkedParentProjectsIds: [],
        linkedParentGoalsIds: [],
        linkedParentSkillsIds: [],
        linkedParentAssistantIds: [],
        parentDone: false,
        suggestedBy: null,
        parentGoalId: null,
        parentGoalIsPublicFor: null,
        noteId: null,
        containerNotesIds: [],
        calendarData: null,
        gmailData: null,
        timesPostponed: 0,
        timesFollowed: 0,
        timesDoneInExpectedDay: 0,
        timesDone: 0,
        isPremium: false,
        lockKey: '',
        assigneeType: TASK_ASSIGNEE_USER_TYPE,
        assistantId: '',
        commentsData: null,
        autoEstimation: null,
        completedTime: null,
        humanReadableId: null,
    }
}

async function upsertDayRateTimeLogTask({
    projectId,
    userId,
    completed,
    adjustmentMinutes,
    statisticsRepairDelta = 0,
    oldEstimationForStats = 0,
    existingTask,
    existingManual,
    manual,
    timezone,
}) {
    const batch = new BatchWrapper(getDb())
    const now = Date.now()
    const nextManual = manual === true || existingManual === true

    if (existingTask) {
        const oldEstimation = getDayRateTaskEstimation(existingTask)
        const updateData = {
            userId,
            userIds: [userId],
            currentReviewerId: DONE_STEP,
            done: true,
            inDone: true,
            isPrivate: true,
            isPublicFor: [userId],
            parentId: null,
            parentDone: false,
            isSubtask: false,
            [`estimations.${OPEN_STEP}`]: adjustmentMinutes,
            completed,
            dueDate: completed,
            lastEditionDate: now,
            lastEditorId: store.getState().loggedUser.uid || userId,
            'genericData.type': DAY_RATE_TIME_LOG_TYPE,
            'genericData.projectId': projectId,
            'genericData.day': getDayRateTimeLogRange(completed, timezone).dayKey,
            'genericData.manual': nextManual,
        }

        if (oldEstimationForStats > 0) {
            updateStatistics(projectId, userId, oldEstimationForStats, true, true, existingTask.completed, batch)
        }
        if (adjustmentMinutes > 0) {
            updateStatistics(projectId, userId, adjustmentMinutes, false, true, completed, batch)
        }
        if (statisticsRepairDelta !== 0) {
            updateStatistics(
                projectId,
                userId,
                Math.abs(statisticsRepairDelta),
                statisticsRepairDelta < 0,
                true,
                completed,
                batch
            )
        }

        logDayRateTimeLog('upsert-existing', {
            projectId,
            userId,
            taskId: existingTask.id,
            completed: formatDayRateTimestamp(completed, timezone),
            previousCompleted: formatDayRateTimestamp(existingTask.completed, timezone),
            oldEstimation,
            oldEstimationForStats,
            adjustmentMinutes,
            statisticsRepairDelta,
            statsUpdated: oldEstimationForStats > 0 || adjustmentMinutes > 0 || statisticsRepairDelta !== 0,
            manual: nextManual,
        })

        batch.update(getDb().doc(`items/${projectId}/tasks/${existingTask.id}`), updateData)
    } else {
        const task = buildDayRateTimeLogTask(projectId, userId, completed, adjustmentMinutes, nextManual, timezone)
        const { id, ...taskData } = task
        logDayRateTimeLog('upsert-new', {
            projectId,
            userId,
            taskId: id,
            completed: formatDayRateTimestamp(completed, timezone),
            adjustmentMinutes,
            statisticsRepairDelta,
            manual: nextManual,
        })
        batch.set(getDb().doc(`items/${projectId}/tasks/${id}`), taskData)
        if (adjustmentMinutes > 0) {
            updateStatistics(projectId, userId, adjustmentMinutes, false, true, completed, batch)
        }
        if (statisticsRepairDelta !== 0) {
            updateStatistics(
                projectId,
                userId,
                Math.abs(statisticsRepairDelta),
                statisticsRepairDelta < 0,
                true,
                completed,
                batch
            )
        }
    }

    await batch.commit()
    logDayRateTimeLog('upsert-committed', {
        projectId,
        userId,
        completed: formatDayRateTimestamp(completed, timezone),
        adjustmentMinutes,
        statisticsRepairDelta,
        existingTask: !!existingTask,
    })
}

export async function reconcileDayRateTimeLog(projectId, userId, timestamp, options = {}) {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeDayRateTimeLogConfig(options.config || project?.dayRateTimeLog)
    const manual = options.manual === true
    const timezone = getDayRateTimezone(options.timezone)
    const source = options.source || (manual ? 'manual-day' : 'day-reconcile')

    if (!projectId || !userId || !timestamp || (!config.enabled && !manual)) {
        logDayRateTimeLog('day-reconcile-skipped', {
            source,
            projectId,
            userId,
            timestamp: formatDayRateTimestamp(timestamp, timezone),
            config,
            manual,
            reason: !projectId
                ? 'missing-project'
                : !userId
                ? 'missing-user'
                : !timestamp
                ? 'missing-timestamp'
                : 'disabled',
        })
        return null
    }

    const tasks = await getDoneTasksForDay(projectId, userId, timestamp, timezone)
    const existingTask = tasks.find(isDayRateTimeLogTask)
    const existingManual = existingTask?.genericData?.manual === true
    const taskAdjustment = calculateDayRateTimeLogAdjustment(tasks, config, manual || existingManual)
    const { shouldLogDay, realDoneTasksAmount, realLoggedMinutes } = taskAdjustment
    const statistics = await getDayRateStatisticsForDay(projectId, userId, timestamp, timezone)
    const oldGeneratedEstimation = existingTask ? getDayRateTaskEstimation(existingTask) : 0
    const oldGeneratedIncludedInStats = existingTask && statistics.doneTime >= oldGeneratedEstimation
    const oldEstimationForStats = oldGeneratedIncludedInStats ? oldGeneratedEstimation : 0
    const adjustmentMinutes = taskAdjustment.adjustmentMinutes
    const statsAfterGeneratedUpdate = statistics.doneTime - oldEstimationForStats + adjustmentMinutes
    const statisticsRepairDelta =
        shouldLogDay && (adjustmentMinutes > 0 || existingTask) ? config.targetMinutes - statsAfterGeneratedUpdate : 0

    logDayRateTimeLog('day-reconcile-calculated', {
        source,
        projectId,
        userId,
        timestamp: formatDayRateTimestamp(timestamp, timezone),
        config,
        manual,
        existingTaskId: existingTask?.id || null,
        existingManual,
        shouldLogDay,
        adjustmentMinutes,
        taskBasedAdjustmentMinutes: taskAdjustment.adjustmentMinutes,
        statisticsDoneTime: statistics.doneTime,
        oldGeneratedEstimation,
        oldGeneratedIncludedInStats,
        oldEstimationForStats,
        statsAfterGeneratedUpdate,
        statisticsRepairDelta,
        realDoneTasksAmount,
        realLoggedMinutes,
        tasks: tasks.map(task => getDayRateTaskLogSummary(task, timezone)),
    })

    if ((!shouldLogDay || (adjustmentMinutes === 0 && statisticsRepairDelta === 0)) && !existingTask) {
        logDayRateTimeLog('day-reconcile-noop', {
            source,
            projectId,
            userId,
            timestamp: formatDayRateTimestamp(timestamp, timezone),
            shouldLogDay,
            adjustmentMinutes,
            realDoneTasksAmount,
            realLoggedMinutes,
        })
        return { adjustmentMinutes: 0, realDoneTasksAmount, realLoggedMinutes, updated: false }
    }

    const completed = existingTask?.completed || timestamp
    await upsertDayRateTimeLogTask({
        projectId,
        userId,
        completed,
        adjustmentMinutes,
        statisticsRepairDelta,
        oldEstimationForStats,
        existingTask,
        existingManual,
        manual,
        timezone,
    })

    logDayRateTimeLog('day-reconcile-finished', {
        source,
        projectId,
        userId,
        completed: formatDayRateTimestamp(completed, timezone),
        adjustmentMinutes,
        statisticsRepairDelta,
        realDoneTasksAmount,
        realLoggedMinutes,
    })

    return { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes, updated: true }
}

export async function reconcileExistingDayRateTimeLog(projectId, userId, timestamp) {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeDayRateTimeLogConfig(project?.dayRateTimeLog)
    const timezone = getDayRateTimezone()

    if (!projectId || !userId || !timestamp) return null

    const tasks = await getDoneTasksForDay(projectId, userId, timestamp, timezone)
    const existingTask = tasks.find(isDayRateTimeLogTask)
    if (!existingTask) {
        logDayRateTimeLog('existing-reconcile-skipped', {
            projectId,
            userId,
            timestamp: formatDayRateTimestamp(timestamp, timezone),
            reason: 'missing-generated-task',
        })
        return { updated: false }
    }

    const existingManual = existingTask?.genericData?.manual === true
    const taskAdjustment = calculateDayRateTimeLogAdjustment(tasks, config, existingManual)
    const { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes } = taskAdjustment
    const statistics = await getDayRateStatisticsForDay(projectId, userId, timestamp, timezone)
    const oldGeneratedEstimation = getDayRateTaskEstimation(existingTask)
    const oldGeneratedIncludedInStats = statistics.doneTime >= oldGeneratedEstimation
    const oldEstimationForStats = oldGeneratedIncludedInStats ? oldGeneratedEstimation : 0
    const statsAfterGeneratedUpdate = statistics.doneTime - oldEstimationForStats + adjustmentMinutes
    const statisticsRepairDelta =
        taskAdjustment.shouldLogDay && (adjustmentMinutes > 0 || existingTask)
            ? config.targetMinutes - statsAfterGeneratedUpdate
            : 0

    await upsertDayRateTimeLogTask({
        projectId,
        userId,
        completed: existingTask.completed,
        adjustmentMinutes,
        statisticsRepairDelta,
        oldEstimationForStats,
        existingTask,
        existingManual,
        manual: false,
        timezone,
    })

    return { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes, updated: true }
}

export async function reconcileDayRateTimeLogsForPastDays(
    projectId,
    userId,
    startTimestamp,
    endTimestamp,
    options = {}
) {
    if (!projectId || !userId || !startTimestamp || !endTimestamp) return []

    const timezone = getDayRateTimezone(options.timezone)
    const source = options.source || 'range-backfill'
    const start = getDayRateTimeLogRange(startTimestamp, timezone).start
    const end = getDayRateTimeLogRange(endTimestamp, timezone).end
    if (start > end) {
        logDayRateTimeLog('range-backfill-skipped', {
            source,
            projectId,
            userId,
            start: formatDayRateTimestamp(startTimestamp, timezone),
            end: formatDayRateTimestamp(endTimestamp, timezone),
            reason: 'start-after-end',
        })
        return []
    }

    const tasks = await getDoneTasksForRange(projectId, userId, start, end)
    const dayTimestamps = [
        ...new Set(
            tasks.filter(task => task.completed).map(task => getDayRateTimeLogRange(task.completed, timezone).start)
        ),
    ].sort((a, b) => a - b)

    logDayRateTimeLog('range-backfill-days', {
        source,
        projectId,
        userId,
        start: formatDayRateTimestamp(start, timezone),
        end: formatDayRateTimestamp(end, timezone),
        taskCount: tasks.length,
        days: dayTimestamps.map(dayTimestamp => formatDayRateTimestamp(dayTimestamp, timezone)),
    })

    const results = []
    for (let i = 0; i < dayTimestamps.length; i++) {
        try {
            results.push(
                await reconcileDayRateTimeLog(projectId, userId, dayTimestamps[i], {
                    timezone,
                    source,
                })
            )
        } catch (error) {
            logDayRateTimeLog('range-backfill-day-error', {
                source,
                projectId,
                userId,
                day: formatDayRateTimestamp(dayTimestamps[i], timezone),
                error,
            })
            throw error
        }
    }
    logDayRateTimeLog('range-backfill-finished', {
        source,
        projectId,
        userId,
        resultsAmount: results.length,
        updatedAmount: results.filter(result => result?.updated).length,
        results,
    })
    return results
}

export async function reconcileProjectDayRateTimeLogsBackfill(
    project,
    userId,
    fallbackStartTimestamp,
    endTimestamp,
    options = {}
) {
    const source =
        options.source || (options.forceFromProjectStart ? 'project-backfill-reset' : 'project-backfill-incremental')
    if (!project?.id || !userId || !endTimestamp) {
        logDayRateTimeLog('project-backfill-skipped', {
            source,
            projectId: project?.id,
            userId,
            endTimestamp,
            reason: !project?.id ? 'missing-project' : !userId ? 'missing-user' : 'missing-end',
        })
        return []
    }

    const rawConfig = project.dayRateTimeLog || {}
    const cursor = rawConfig[DAY_RATE_BACKFILL_CURSOR_FIELD]?.[userId]
    const backfillVersion = rawConfig[DAY_RATE_BACKFILL_VERSION_FIELD]?.[userId]
    const shouldIgnoreCursor = options.forceFromProjectStart || backfillVersion !== DAY_RATE_BACKFILL_VERSION
    const projectStart = project.projectStartDate || project.created || fallbackStartTimestamp
    const timezone = getDayRateTimezone(options.timezone)
    const startTimestamp =
        cursor && !shouldIgnoreCursor
            ? getDayRateMoment(cursor, timezone).add(1, 'day').startOf('day').valueOf()
            : projectStart
    const end = getDayRateTimeLogRange(endTimestamp, timezone).end

    logDayRateTimeLog('project-backfill-start', {
        source,
        projectId: project.id,
        userId,
        cursor: formatDayRateTimestamp(cursor, timezone),
        backfillVersion,
        currentBackfillVersion: DAY_RATE_BACKFILL_VERSION,
        shouldIgnoreCursor,
        projectStart: formatDayRateTimestamp(projectStart, timezone),
        fallbackStart: formatDayRateTimestamp(fallbackStartTimestamp, timezone),
        start: formatDayRateTimestamp(startTimestamp, timezone),
        end: formatDayRateTimestamp(end, timezone),
    })

    if (!startTimestamp || startTimestamp > end) {
        logDayRateTimeLog('project-backfill-skipped', {
            source,
            projectId: project.id,
            userId,
            start: formatDayRateTimestamp(startTimestamp, timezone),
            end: formatDayRateTimestamp(end, timezone),
            reason: !startTimestamp ? 'missing-start' : 'start-after-end',
        })
        return []
    }

    const results = await reconcileDayRateTimeLogsForPastDays(project.id, userId, startTimestamp, end, {
        timezone,
        source,
    })
    await getDb()
        .doc(`/projects/${project.id}`)
        .update({
            [`dayRateTimeLog.${DAY_RATE_BACKFILL_CURSOR_FIELD}.${userId}`]: end,
            [`dayRateTimeLog.${DAY_RATE_BACKFILL_VERSION_FIELD}.${userId}`]: DAY_RATE_BACKFILL_VERSION,
        })
    logDayRateTimeLog('project-backfill-cursor-updated', {
        source,
        projectId: project.id,
        userId,
        cursor: formatDayRateTimestamp(end, timezone),
        backfillVersion: DAY_RATE_BACKFILL_VERSION,
        resultsAmount: results.length,
        updatedAmount: results.filter(result => result?.updated).length,
    })

    return results
}

export async function markDayRateDayWorked(projectId, userId, timestamp, options = {}) {
    return reconcileDayRateTimeLog(projectId, userId, timestamp, { ...options, manual: true })
}
