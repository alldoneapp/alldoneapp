import moment from 'moment'

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

export function getDayRateTimeLogRange(timestamp) {
    const day = moment(timestamp)
    return {
        start: day.clone().startOf('day').valueOf(),
        end: day.clone().endOf('day').valueOf(),
        dayKey: day.format('YYYYMMDD'),
    }
}

export function calculateDayRateTimeLogAdjustment(tasks = [], config = {}, forceWorkedDay = false) {
    const normalizedConfig = normalizeDayRateTimeLogConfig(config)
    const realDoneTasks = tasks.filter(task => !task.parentId && !isDayRateTimeLogTask(task))
    const realLoggedMinutes = realDoneTasks.reduce((total, task) => total + (task.estimations?.[OPEN_STEP] || 0), 0)
    const hasManualNonCalendarLoggedTime = realDoneTasks.some(
        task => !task.calendarData && (task.estimations?.[OPEN_STEP] || 0) > 0
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

async function getDoneTasksForDay(projectId, userId, timestamp) {
    const { start, end } = getDayRateTimeLogRange(timestamp)
    const snapshot = await getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('done', '==', true)
        .where('completed', '>=', start)
        .where('completed', '<=', end)
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

async function getDoneTasksForRange(projectId, userId, start, end) {
    const snapshot = await getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('done', '==', true)
        .where('completed', '>=', start)
        .where('completed', '<=', end)
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

function buildDayRateTimeLogTask(projectId, userId, completed, adjustmentMinutes, manual) {
    const now = Date.now()
    const { loggedUser } = store.getState()
    const dayKey = getDayRateTimeLogRange(completed).dayKey
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
    existingTask,
    existingManual,
    manual,
}) {
    const batch = new BatchWrapper(getDb())
    const now = Date.now()
    const nextManual = manual === true || existingManual === true

    if (existingTask) {
        const oldEstimation = existingTask.estimations?.[OPEN_STEP] || 0
        const updateData = {
            [`estimations.${OPEN_STEP}`]: adjustmentMinutes,
            completed,
            dueDate: completed,
            lastEditionDate: now,
            lastEditorId: store.getState().loggedUser.uid || userId,
            'genericData.manual': nextManual,
        }

        if (oldEstimation !== adjustmentMinutes || existingTask.completed !== completed) {
            updateStatistics(projectId, userId, oldEstimation, true, true, existingTask.completed, batch)
            updateStatistics(projectId, userId, adjustmentMinutes, false, true, completed, batch)
        }

        batch.update(getDb().doc(`items/${projectId}/tasks/${existingTask.id}`), updateData)
    } else {
        const task = buildDayRateTimeLogTask(projectId, userId, completed, adjustmentMinutes, nextManual)
        const { id, ...taskData } = task
        batch.set(getDb().doc(`items/${projectId}/tasks/${id}`), taskData)
        updateStatistics(projectId, userId, adjustmentMinutes, false, true, completed, batch)
    }

    await batch.commit()
}

export async function reconcileDayRateTimeLog(projectId, userId, timestamp, options = {}) {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeDayRateTimeLogConfig(options.config || project?.dayRateTimeLog)
    const manual = options.manual === true

    if (!projectId || !userId || !timestamp || (!config.enabled && !manual)) return null

    const tasks = await getDoneTasksForDay(projectId, userId, timestamp)
    const existingTask = tasks.find(isDayRateTimeLogTask)
    const existingManual = existingTask?.genericData?.manual === true
    const {
        adjustmentMinutes,
        shouldLogDay,
        realDoneTasksAmount,
        realLoggedMinutes,
    } = calculateDayRateTimeLogAdjustment(tasks, config, manual || existingManual)

    if ((!shouldLogDay || adjustmentMinutes === 0) && !existingTask) {
        return { adjustmentMinutes: 0, realDoneTasksAmount, realLoggedMinutes, updated: false }
    }

    const completed = existingTask?.completed || timestamp
    await upsertDayRateTimeLogTask({
        projectId,
        userId,
        completed,
        adjustmentMinutes,
        existingTask,
        existingManual,
        manual,
    })

    return { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes, updated: true }
}

export async function reconcileExistingDayRateTimeLog(projectId, userId, timestamp) {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeDayRateTimeLogConfig(project?.dayRateTimeLog)

    if (!projectId || !userId || !timestamp) return null

    const tasks = await getDoneTasksForDay(projectId, userId, timestamp)
    const existingTask = tasks.find(isDayRateTimeLogTask)
    if (!existingTask) return { updated: false }

    const existingManual = existingTask?.genericData?.manual === true
    const { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes } = calculateDayRateTimeLogAdjustment(
        tasks,
        config,
        existingManual
    )

    await upsertDayRateTimeLogTask({
        projectId,
        userId,
        completed: existingTask.completed,
        adjustmentMinutes,
        existingTask,
        existingManual,
        manual: false,
    })

    return { adjustmentMinutes, realDoneTasksAmount, realLoggedMinutes, updated: true }
}

export async function reconcileDayRateTimeLogsForPastDays(projectId, userId, startTimestamp, endTimestamp) {
    if (!projectId || !userId || !startTimestamp || !endTimestamp) return []

    const start = moment(startTimestamp).startOf('day').valueOf()
    const end = moment(endTimestamp).endOf('day').valueOf()
    if (start > end) return []

    const tasks = await getDoneTasksForRange(projectId, userId, start, end)
    const dayTimestamps = [
        ...new Set(tasks.filter(task => task.completed).map(task => moment(task.completed).startOf('day').valueOf())),
    ].sort((a, b) => a - b)

    const results = []
    for (let i = 0; i < dayTimestamps.length; i++) {
        results.push(await reconcileDayRateTimeLog(projectId, userId, dayTimestamps[i]))
    }
    return results
}

export async function markDayRateDayWorked(projectId, userId, timestamp) {
    return reconcileDayRateTimeLog(projectId, userId, timestamp, { manual: true })
}
