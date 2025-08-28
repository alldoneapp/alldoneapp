const { setFeedObjectLastState } = require('./globalFeedsHelper')
const { OPEN_STEP, FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { getGlobalState } = require('../GlobalState/globalState')

function generateTaskObjectModel(currentMilliseconds, task, taskId) {
    return {
        type: 'task',
        parentId: task.parentId ? task.parentId : '',
        subtaskIds: task.subtaskIds ? task.subtaskIds : [],
        lastChangeDate: currentMilliseconds,
        taskId: taskId,
        name: task.extendedName ? task.extendedName : task.name,
        assigneeEstimation: task.estimations[OPEN_STEP],
        recurrence: task.recurrence,
        isDone: task.done,
        isDeleted: false,
        privacy: task.isPrivate ? task.userId : 'public',
        linkBack: task.linkBack ? task.linkBack : '',
        comments: task.comments ? task.comments : [],
        userId: task.userId || task.userIds[0],
        genericData: task.genericData ? task.genericData : null,
        isPublicFor: task.isPublicFor ? task.isPublicFor : task.isPrivate ? [task.userId] : [FEED_PUBLIC_FOR_ALL],
        lockKey: task.lockKey ? task.lockKey : '',
    }
}

const updateTasksFeedsAmountOfSubtasks = async (
    projectId,
    taskId,
    subtaskId,
    currentDateFormated,
    amountVariation,
    batch
) => {
    const { admin, appAdmin } = getGlobalState()
    const feedObjectRef = appAdmin.firestore().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${taskId}`)
    const subtaskIds =
        amountVariation > 0
            ? admin.firestore.FieldValue.arrayUnion(subtaskId)
            : admin.firestore.FieldValue.arrayRemove(subtaskId)
    const taskChanges = { subtaskIds }
    batch.set(feedObjectRef, taskChanges, { merge: true })
    setFeedObjectLastState(projectId, 'tasks', taskId, taskChanges, batch)
}

module.exports = {
    generateTaskObjectModel,
    updateTasksFeedsAmountOfSubtasks,
}
