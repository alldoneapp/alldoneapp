const admin = require('firebase-admin')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createTaskUpdatedFeed } = require('../Feeds/tasksFeeds')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')
const { createTaskObject } = require('../shared/TaskModelBuilder')
const { deleteTask, uploadTask } = require('../Tasks/tasksFirestoreCloud')
const { onDeleteTask } = require('../Tasks/onDeleteTaskFunctions')
const { FEED_PUBLIC_FOR_ALL, MENTION_SPACE_CODE, TASK_ASSIGNEE_USER_TYPE } = require('../Utils/HelperFunctionsCloud')
const {
    AUTO_FOLLOW_UP_TYPE,
    calculateFollowUpDueDate,
    getContactMentionText,
    getFollowUpTaskTitle,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
    isOpenTask,
    normalizeFollowUpDays,
    sortTasksDeterministically,
} = require('./contactFollowUpTasksHelper')

async function getProjectData(projectId) {
    const projectDoc = await admin.firestore().doc(`projects/${projectId}`).get()
    return projectDoc.exists ? projectDoc.data() || {} : null
}

async function getContactStatus(projectId, statusId, projectData = null) {
    if (!statusId) return null

    const resolvedProjectData = projectData || (await getProjectData(projectId))
    return resolvedProjectData?.contactStatuses?.[statusId] || null
}

async function getManagedFollowUpTasks(projectId, contactId) {
    const taskDocs = (
        await admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('autoFollowUpContactId', '==', contactId)
            .get()
    ).docs

    return taskDocs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(task => isManagedContactStatusFollowUpTask(task) && task.autoFollowUpContactId === contactId)
}

function getManagedTaskUpdate(contact, statusId, followUpDays) {
    const title = getFollowUpTaskTitle(contact)
    const mentionText = getContactMentionText(contact, MENTION_SPACE_CODE)
    const extendedName = mentionText ? `Follow up with ${mentionText}` : title
    const dueDate = calculateFollowUpDueDate(contact.lastEditionDate, followUpDays)
    const assigneeId = contact.recorderUserId
    const isPublicFor =
        Array.isArray(contact.isPublicFor) && contact.isPublicFor.length > 0
            ? contact.isPublicFor
            : [FEED_PUBLIC_FOR_ALL, assigneeId].filter(Boolean)

    return {
        name: extendedName.toLowerCase(),
        extendedName,
        userId: assigneeId,
        userIds: [assigneeId],
        currentReviewerId: assigneeId,
        assigneeType: TASK_ASSIGNEE_USER_TYPE,
        dueDate,
        isPrivate: !!contact.isPrivate,
        isPublicFor,
        linkedParentContactsIds: [contact.uid],
        autoFollowUpManaged: true,
        autoFollowUpType: AUTO_FOLLOW_UP_TYPE,
        autoFollowUpContactId: contact.uid,
        autoFollowUpStatusId: statusId,
        lastEditorId: contact.lastEditorId || assigneeId || '',
        lastEditionDate: Date.now(),
    }
}

function buildManagedFollowUpTask(projectId, contact, statusId, followUpDays) {
    const taskId = admin.firestore().collection('_').doc().id
    const title = getFollowUpTaskTitle(contact)
    const mentionText = getContactMentionText(contact, MENTION_SPACE_CODE)
    const extendedName = mentionText ? `Follow up with ${mentionText}` : title
    const assigneeId = contact.recorderUserId

    const task = createTaskObject({
        name: extendedName,
        userId: assigneeId,
        userIds: [assigneeId],
        projectId,
        taskId,
        dueDate: calculateFollowUpDueDate(contact.lastEditionDate, followUpDays),
        isPrivate: !!contact.isPrivate,
        assigneeType: TASK_ASSIGNEE_USER_TYPE,
        now: Date.now(),
        autoFollowUpManaged: true,
        autoFollowUpType: AUTO_FOLLOW_UP_TYPE,
        autoFollowUpContactId: contact.uid,
        autoFollowUpStatusId: statusId,
    })

    task.name = extendedName.toLowerCase()
    task.extendedName = extendedName
    task.creatorId = assigneeId
    task.lastEditorId = contact.lastEditorId || assigneeId || ''
    task.isPublicFor =
        Array.isArray(contact.isPublicFor) && contact.isPublicFor.length > 0
            ? contact.isPublicFor
            : [FEED_PUBLIC_FOR_ALL, assigneeId].filter(Boolean)
    task.linkedParentContactsIds = [contact.uid]

    return task
}

async function deleteManagedTask(projectId, task) {
    await onDeleteTask(projectId, task)
    await deleteTask(projectId, task.id, admin)
}

async function createManagedFollowUpUpdateFeed(projectId, projectData, taskId, task) {
    const feedCreator = {
        uid: `system-contact-follow-up-${task.autoFollowUpContactId || taskId}`,
        displayName: 'System',
        photoURL: '',
    }

    loadFeedsGlobalState(admin, admin, feedCreator, { id: projectId, userIds: projectData?.userIds || [] }, null, null)

    const batch = new BatchWrapper(admin.firestore())
    await createTaskUpdatedFeed(projectId, task, taskId, batch, feedCreator, true, {
        entryText: 'scheduled contact follow-up',
    })
    await batch.commit()
}

async function deleteOpenManagedFollowUpTasks(projectId, contactId) {
    const tasks = await getManagedFollowUpTasks(projectId, contactId)
    const openTasks = tasks.filter(isOpenTask)
    await Promise.all(openTasks.map(task => deleteManagedTask(projectId, task)))
}

async function syncContactFollowUpTask(projectId, contact) {
    const projectData = await getProjectData(projectId)
    const status = await getContactStatus(projectId, contact.contactStatusId, projectData)
    const followUpDays = normalizeFollowUpDays(status?.followUpDays)

    const tasks = await getManagedFollowUpTasks(projectId, contact.uid)
    const openTasks = tasks.filter(isOpenTask)
    const primaryTask = getPrimaryOpenManagedTask(openTasks)
    const duplicateOpenTasks = primaryTask ? openTasks.filter(task => task.id !== primaryTask.id) : openTasks

    if (duplicateOpenTasks.length > 0) {
        await Promise.all(duplicateOpenTasks.map(task => deleteManagedTask(projectId, task)))
    }

    if (!followUpDays || !contact.recorderUserId) {
        if (primaryTask) await deleteManagedTask(projectId, primaryTask)
        return
    }

    const updateData = getManagedTaskUpdate(contact, status.id, followUpDays)

    if (primaryTask) {
        await admin.firestore().doc(`items/${projectId}/tasks/${primaryTask.id}`).update(updateData)
        await createManagedFollowUpUpdateFeed(projectId, projectData, primaryTask.id, {
            ...primaryTask,
            ...updateData,
            id: primaryTask.id,
        })
        return
    }

    const newTask = buildManagedFollowUpTask(projectId, contact, status.id, followUpDays)
    await uploadTask(admin, projectId, newTask)
    await createManagedFollowUpUpdateFeed(projectId, projectData, newTask.id, newTask)
}

module.exports = {
    AUTO_FOLLOW_UP_TYPE,
    calculateFollowUpDueDate,
    deleteOpenManagedFollowUpTasks,
    getFollowUpTaskTitle,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
    normalizeFollowUpDays,
    sortTasksDeterministically,
    syncContactFollowUpTask,
}
