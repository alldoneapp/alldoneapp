const AUTO_FOLLOW_UP_TYPE = 'contact-status'
const DAY_IN_MS = 24 * 60 * 60 * 1000

function normalizeFollowUpDays(value) {
    const parsedValue = Number(value)
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function calculateFollowUpDueDate(lastEditionDate, followUpDays) {
    return (lastEditionDate || Date.now()) + followUpDays * DAY_IN_MS
}

function getFollowUpTaskTitle(contact) {
    const displayName = contact?.displayName?.trim()
    return `Follow up with ${displayName || 'this contact'}`
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

module.exports = {
    AUTO_FOLLOW_UP_TYPE,
    DAY_IN_MS,
    calculateFollowUpDueDate,
    getFollowUpTaskTitle,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
    isOpenTask,
    normalizeFollowUpDays,
    sortTasksDeterministically,
}
