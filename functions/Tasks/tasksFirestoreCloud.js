const admin = require('firebase-admin')

const { createTaskFeedChain } = require('../Feeds/tasksFeedsChains')
const { logEvent } = require('../GAnalytics/GAnalytics')
const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')

const deleteTask = async (projectId, taskId, admin) => {
    await admin.firestore().doc(`items/${projectId}/tasks/${taskId}`).delete()
}

const getTasksFromAssignee = async (projectId, assigneeId, admin) => {
    const taskDocs = (
        await admin.firestore().collection(`items/${projectId}/tasks`).where('userId', '==', assigneeId).get()
    ).docs
    const tasks = []
    taskDocs.forEach(doc => {
        tasks.push({ ...doc.data(), id: doc.id })
    })
    return tasks
}

const deleteTasksFromAssignee = async (projectId, assigneeId, admin) => {
    const tasks = await getTasksFromAssignee(projectId, assigneeId, admin)
    const promises = []
    tasks.forEach(task => {
        promises.push(deleteTask(projectId, task.id, admin))
    })
    await Promise.all(promises)
}

async function uploadTask(appAdmin, projectId, task) {
    const taskCopy = { ...task }
    delete taskCopy.id

    const promises = []
    promises.push(appAdmin.firestore().collection(`items/${projectId}/tasks`).doc(task.id).set(taskCopy))
    promises.push(createTaskFeedChain(projectId, task.id, task, false, false))
    promises.push(logEvent('', 'new_task', { taskOwnerUid: task.userId, estimation: task.estimations[OPEN_STEP] }))
    await Promise.all(promises)
}

const updateTaskEditionData = async (projectId, taskId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)
            const taskDoc = await transaction.get(ref)
            if (taskDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const deleteTaskMetaData = async (projectId, taskId) => {
    await admin.firestore().doc(`items/${projectId}/tasks/${taskId}`).update({
        metaData: admin.firestore.FieldValue.delete(),
    })
}

const updateTaskLastCommentData = async (projectId, taskId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)
            const taskDoc = await transaction.get(ref)
            if (taskDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

module.exports = {
    deleteTask,
    deleteTasksFromAssignee,
    uploadTask,
    updateTaskEditionData,
    updateTaskLastCommentData,
    deleteTaskMetaData,
}
