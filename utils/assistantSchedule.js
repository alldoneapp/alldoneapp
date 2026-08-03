import moment from 'moment-timezone'

import {
    RECURRENCE_ANNUALLY,
    RECURRENCE_DAILY,
    RECURRENCE_EVERY_2_WEEKS,
    RECURRENCE_EVERY_3_MONTHS,
    RECURRENCE_EVERY_3_WEEKS,
    RECURRENCE_EVERY_6_MONTHS,
    RECURRENCE_EVERY_WORKDAY,
    RECURRENCE_MONTHLY,
    RECURRENCE_NEVER,
    RECURRENCE_ONCE,
    RECURRENCE_WEEKLY,
    getCustomRecurrenceDays,
} from '../components/TaskListView/Utils/TasksHelper'

const DEFAULT_HORIZON_DAYS = 30
const DEFAULT_MAX_OCCURRENCES = 1

const getTimezoneName = user => {
    const timezone = user?.timezoneName || user?.preferredTimezone || user?.timeZone
    return typeof timezone === 'string' && moment.tz.zone(timezone) ? timezone : moment.tz.guess()
}

const buildScheduleStart = (task, user) => {
    if (!task?.startDate || !task?.startTime) return null

    const date = moment(task.startDate).format('YYYY-MM-DD')
    const timezoneName = getTimezoneName(user)
    const value = moment.tz(`${date} ${task.startTime}`, 'YYYY-MM-DD HH:mm', timezoneName)
    return value.isValid() ? value : null
}

const advanceOccurrence = (value, recurrence) => {
    const next = value.clone()
    switch (recurrence) {
        case RECURRENCE_DAILY:
            return next.add(1, 'day')
        case RECURRENCE_EVERY_WORKDAY:
            do {
                next.add(1, 'day')
            } while (next.isoWeekday() > 5)
            return next
        case RECURRENCE_WEEKLY:
            return next.add(1, 'week')
        case RECURRENCE_EVERY_2_WEEKS:
            return next.add(2, 'weeks')
        case RECURRENCE_EVERY_3_WEEKS:
            return next.add(3, 'weeks')
        case RECURRENCE_MONTHLY:
            return next.add(1, 'month')
        case RECURRENCE_EVERY_3_MONTHS:
            return next.add(3, 'months')
        case RECURRENCE_EVERY_6_MONTHS:
            return next.add(6, 'months')
        case RECURRENCE_ANNUALLY:
            return next.add(1, 'year')
        default: {
            const customDays = getCustomRecurrenceDays(recurrence)
            return customDays ? next.add(customDays, 'days') : null
        }
    }
}

export const getScheduleActivations = task => {
    const recurrenceByUser = task?.recurrenceByUser || {}
    const completedOneOffUserIds = new Set(task?.completedOneOffUserIds || [])
    const activations = Object.entries(recurrenceByUser)
        .filter(
            ([userId, recurrence]) =>
                userId &&
                recurrence &&
                recurrence !== RECURRENCE_NEVER &&
                !(recurrence === RECURRENCE_ONCE && completedOneOffUserIds.has(userId))
        )
        .map(([userId, recurrence]) => ({ userId, recurrence }))

    const knownIds = new Set(activations.map(item => item.userId))
    const fallbackRecurrence = task?.recurrence
    const hasExplicitActivationState = Array.isArray(task?.activatedUserIds) || task?.recurrenceByUser !== undefined
    if (!hasExplicitActivationState && fallbackRecurrence && fallbackRecurrence !== RECURRENCE_NEVER) {
        const fallbackIds = [
            ...(Array.isArray(task?.activatedUserIds) ? task.activatedUserIds : []),
            task?.activatorUserId,
            task?.creatorUserId,
        ].filter(Boolean)
        fallbackIds.forEach(userId => {
            if (
                !knownIds.has(userId) &&
                !(fallbackRecurrence === RECURRENCE_ONCE && completedOneOffUserIds.has(userId))
            ) {
                knownIds.add(userId)
                activations.push({ userId, recurrence: fallbackRecurrence })
            }
        })
    }

    return activations
}

export const buildAssistantScheduleOccurrences = (
    tasks,
    getUser,
    { now = Date.now(), horizonDays = DEFAULT_HORIZON_DAYS, maxOccurrences = DEFAULT_MAX_OCCURRENCES } = {}
) => {
    const horizon = moment(now).add(horizonDays, 'days')
    const occurrences = []

    ;(tasks || []).forEach(task => {
        getScheduleActivations(task).forEach(({ userId, recurrence }) => {
            const user = getUser(userId)
            let next = buildScheduleStart(task, user)
            if (!next) return

            const lastExecuted = task?.lastExecutedByUser?.[userId]
            const executionStatus = task?.executionByUser?.[userId]?.status
            if (
                recurrence === RECURRENCE_ONCE &&
                (executionStatus === 'succeeded' || (executionStatus === undefined && lastExecuted))
            ) {
                return
            }

            let guard = 0
            while (lastExecuted && next.valueOf() <= Number(lastExecuted) && guard < 10000) {
                next = advanceOccurrence(next, recurrence)
                guard++
                if (!next) return
            }

            let amount = 0
            while (next && amount < maxOccurrences && (next.isSameOrBefore(horizon) || amount === 0)) {
                occurrences.push({
                    id: `${task.id}:${userId}:${next.valueOf()}`,
                    task,
                    user,
                    userId,
                    recurrence,
                    timestamp: next.valueOf(),
                    dateKey: next.clone().local().format('YYYYMMDD'),
                    timezoneName: getTimezoneName(user),
                    status: task?.executionByUser?.[userId]?.status || null,
                    error: task?.executionByUser?.[userId]?.error || null,
                })
                amount++
                if (recurrence === RECURRENCE_ONCE) break
                next = advanceOccurrence(next, recurrence)
            }
        })
    })

    return occurrences.sort((a, b) => a.timestamp - b.timestamp || a.task.name.localeCompare(b.task.name))
}

export const getAssistantScheduleTimelineDateKey = (occurrence, now = Date.now()) => {
    const today = moment(now).format('YYYYMMDD')
    return occurrence.dateKey <= today ? '0' : occurrence.dateKey
}

export const buildAssistantProfileTimelineDates = (taskDateKeys, occurrences, now = Date.now()) => {
    const taskDateIndexByKey = new Map((taskDateKeys || []).map((dateKey, dateIndex) => [dateKey, dateIndex]))
    const occurrencesByDateKey = {}

    ;(occurrences || []).forEach(occurrence => {
        const dateKey = getAssistantScheduleTimelineDateKey(occurrence, now)
        if (!occurrencesByDateKey[dateKey]) occurrencesByDateKey[dateKey] = []
        occurrencesByDateKey[dateKey].push(occurrence)
    })

    const dateKeys = [...new Set([...(taskDateKeys || []), ...Object.keys(occurrencesByDateKey)])]
    const dateSortValue = dateKey => {
        if (dateKey === '0') return 0
        return /^\d{8}$/.test(dateKey) ? Number(dateKey) : Number.MAX_SAFE_INTEGER
    }
    dateKeys.sort((a, b) => dateSortValue(a) - dateSortValue(b))

    return dateKeys.map(dateKey => ({
        dateKey,
        dateIndex: taskDateIndexByKey.has(dateKey) ? taskDateIndexByKey.get(dateKey) : null,
        occurrences: occurrencesByDateKey[dateKey] || [],
    }))
}
