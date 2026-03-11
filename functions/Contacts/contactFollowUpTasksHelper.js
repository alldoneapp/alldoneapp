const moment = require('moment-timezone')

const { TaskRetrievalService } = require('../shared/TaskRetrievalService')

const AUTO_FOLLOW_UP_TYPE = 'contact-status'
const DAY_IN_MS = 24 * 60 * 60 * 1000

function normalizeFollowUpDays(value) {
    const parsedValue = Number(value)
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function calculateFollowUpDueDate(lastEditionDate, followUpDays) {
    return (lastEditionDate || Date.now()) + followUpDays * DAY_IN_MS
}

function normalizeTimezoneOffset(value) {
    const normalizedOffset = TaskRetrievalService.normalizeTimezoneOffset(value)
    if (typeof normalizedOffset === 'number' && !Number.isNaN(normalizedOffset)) return normalizedOffset

    if (typeof value === 'string') {
        const trimmedValue = value.trim()
        if (trimmedValue && moment.tz.zone(trimmedValue)) {
            return moment.tz(trimmedValue).utcOffset()
        }
    }

    return 0
}

function getEndOfTodayTimestamp(timezoneOffset = 0, now = Date.now()) {
    return moment(now).utcOffset(timezoneOffset).endOf('day').valueOf()
}

function getFollowUpTaskTitle(contact) {
    const displayName = contact?.displayName?.trim()
    return `Follow up with ${displayName || 'this contact'}`
}

function getContactMentionText(contact, mentionSpaceCode) {
    const displayName = contact?.displayName?.trim()
    if (!displayName || !contact?.uid) return ''
    return `@${displayName.replace(/ /g, mentionSpaceCode)}#${contact.uid}`
}

function isManagedContactStatusFollowUpTask(task) {
    return (
        task?.autoFollowUpManaged === true &&
        task?.autoFollowUpType === AUTO_FOLLOW_UP_TYPE &&
        !!task?.autoFollowUpContactId
    )
}

function isOpenTask(task) {
    return task?.done !== true && task?.inDone !== true
}

function sortTasksDeterministically(tasks) {
    return [...tasks].sort((taskA, taskB) => {
        const createdA = taskA?.created || 0
        const createdB = taskB?.created || 0
        if (createdA !== createdB) return createdA - createdB
        return `${taskA?.id || ''}`.localeCompare(`${taskB?.id || ''}`)
    })
}

function getPrimaryOpenManagedTask(tasks) {
    return sortTasksDeterministically(tasks)[0] || null
}

function classifyManagedOpenTasks(tasks, endOfTodayTimestamp) {
    const sortedTasks = sortTasksDeterministically(tasks)
    const currentTasks = []
    const futureTasks = []

    sortedTasks.forEach(task => {
        if ((task?.dueDate || 0) <= endOfTodayTimestamp) {
            currentTasks.push(task)
        } else {
            futureTasks.push(task)
        }
    })

    return {
        currentTask: currentTasks[0] || null,
        futureTask: futureTasks[0] || null,
        duplicateCurrentTasks: currentTasks.slice(1),
        duplicateFutureTasks: futureTasks.slice(1),
    }
}

function getManagedTaskBuckets(tasks, timezoneOffset = 0, now = Date.now()) {
    const endOfTodayTimestamp = getEndOfTodayTimestamp(timezoneOffset, now)
    return {
        endOfTodayTimestamp,
        ...classifyManagedOpenTasks(tasks, endOfTodayTimestamp),
    }
}

module.exports = {
    AUTO_FOLLOW_UP_TYPE,
    DAY_IN_MS,
    calculateFollowUpDueDate,
    classifyManagedOpenTasks,
    getEndOfTodayTimestamp,
    getContactMentionText,
    getFollowUpTaskTitle,
    getManagedTaskBuckets,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
    isOpenTask,
    normalizeTimezoneOffset,
    normalizeFollowUpDays,
    sortTasksDeterministically,
}
