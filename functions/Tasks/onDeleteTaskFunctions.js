const admin = require('firebase-admin')

const { deleteRecord, TASKS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { deleteTask, updateTaskEditionData } = require('./tasksFirestoreCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')
const { clearUserTaskInFocusIfMatch } = require('../Users/usersFirestore')

const deleteSubtasks = async (projectId, subtaskIds) => {
    const promises = []
    subtaskIds.forEach(taskId => {
        promises.push(deleteTask(projectId, taskId, admin))
    })
    await Promise.all(promises)
}

const deleteSubTaskFromParent = async (projectId, parentId, subtaskId, parentTask) => {
    let { subtaskIds, subtaskNames } = parentTask
    const subtaskIndex = subtaskIds.indexOf(subtaskId)

    if (subtaskIndex > -1) {
        subtaskIds.splice(subtaskIndex, 1)
        subtaskNames.splice(subtaskIndex, 1)

        await admin.firestore().doc(`items/${projectId}/tasks/${parentId}`).update({
            subtaskIds,
            subtaskNames,
        })
    }
}

const tryDeleteSubTaskFromParent = async (projectId, parentId, subtaskId) => {
    const parentTask = (await admin.firestore().doc(`items/${projectId}/tasks/${parentId}`).get()).data()
    if (parentTask) deleteSubTaskFromParent(projectId, parentId, subtaskId, parentTask)
}

const onDeleteTask = async (projectId, task) => {
    const { id: taskId, noteId, subtaskIds, parentId, movingToOtherProjectId } = task

    const promises = []
    promises.push(deleteChat(admin, projectId, taskId))
    if (noteId) promises.push(deleteNote(projectId, noteId, movingToOtherProjectId, admin))
    if (subtaskIds) promises.push(deleteSubtasks(projectId, subtaskIds))
    if (parentId) {
        promises.push(tryDeleteSubTaskFromParent(projectId, parentId, taskId))
        promises.push(updateTaskEditionData(projectId, task.parentId, task.lastEditorId))
    }
    if (!movingToOtherProjectId)
        promises.push(removeObjectFromBacklinks(projectId, 'linkedParentTasksIds', taskId, admin))
    if (!task.parentId && task.parentGoalId) promises.push(updateGoalDynamicProgress(projectId, task.parentGoalId))
    if (task.parentGoalId) promises.push(updateGoalEditionData(projectId, task.parentGoalId, task.lastEditorId))
    promises.push(deleteRecord(taskId, projectId, TASKS_OBJECTS_TYPE))
    if (!task.inDone) promises.push(updateContactOpenTasksAmount(projectId, task.userId, -1))
    promises.push(clearUserTaskInFocusIfMatch(task.userId, taskId))
    await Promise.all(promises)
}

module.exports = {
    onDeleteTask,
    deleteSubTaskFromParent,
}
