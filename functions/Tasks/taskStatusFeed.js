'use strict'

const admin = require('firebase-admin')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { FEED_TASK_CHECKED_DONE, FEED_TASK_UNCHECKED_DONE } = require('../Feeds/FeedsConstants')
const { createTaskUpdatedFeed } = require('../Feeds/tasksFeeds')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')

const normalizeTaskForFeeds = task => {
    const estimations = task?.estimations ? { ...task.estimations } : { Open: 0 }
    const openEstimation =
        typeof estimations['-1'] === 'number'
            ? estimations['-1']
            : typeof estimations.Open === 'number'
              ? estimations.Open
              : 0
    if (estimations['-1'] === undefined) estimations['-1'] = openEstimation
    if (estimations.Open === undefined) estimations.Open = openEstimation
    return { ...task, estimations }
}

const buildTaskStatusFeedDescriptor = (taskId, oldTask = {}, newTask = {}) => {
    if (Boolean(oldTask.done) === Boolean(newTask.done)) return null

    const done = Boolean(newTask.done)
    const isSubtask = Boolean(newTask.parentId)
    const transitionTimestamp = Number(newTask.lastEditionDate || newTask.completed || 0)
    return {
        done,
        feedId: `task-status-${transitionTimestamp}-${done ? 'done' : 'open'}`,
        feedType: done ? FEED_TASK_CHECKED_DONE : FEED_TASK_UNCHECKED_DONE,
        entryText: done
            ? isSubtask
                ? 'checked subtask as Done'
                : 'checked task as Done'
            : isSubtask
              ? 'changed subtask to Open'
              : 'changed task to Open',
        taskId,
    }
}

async function persistTaskStatusFeed({ projectId, taskId, oldTask, newTask, database = admin.firestore() }) {
    const descriptor = buildTaskStatusFeedDescriptor(taskId, oldTask, newTask)
    if (!descriptor) return false

    const actorId = newTask.lastEditorId || newTask.userId
    if (!actorId) throw new Error(`Task ${taskId} status feed has no actor`)

    const [projectSnapshot, actorSnapshot] = await Promise.all([
        database.doc(`projects/${projectId}`).get(),
        database.doc(`users/${actorId}`).get(),
    ])
    if (!projectSnapshot.exists) throw new Error(`Project ${projectId} not found for task status feed`)

    const project = { ...projectSnapshot.data(), id: projectId }
    const actor = actorSnapshot.exists ? actorSnapshot.data() : {}
    const feedCreator = {
        uid: actorId,
        displayName: actor.displayName || newTask.lastEditorName || 'Alldone',
        photoURL: actor.photoURL || '',
    }

    loadFeedsGlobalState(admin, admin, feedCreator, project, [], null)
    const batch = new BatchWrapper(database)
    if (batch.setProjectContext) batch.setProjectContext(projectId)

    await createTaskUpdatedFeed(projectId, normalizeTaskForFeeds(newTask), taskId, batch, feedCreator, true, {
        feedCreator,
        project,
        feedId: descriptor.feedId,
        feedType: descriptor.feedType,
        entryText: descriptor.entryText,
        isDone: descriptor.done,
    })
    await batch.commit()
    return true
}

module.exports = {
    buildTaskStatusFeedDescriptor,
    normalizeTaskForFeeds,
    persistTaskStatusFeed,
}
