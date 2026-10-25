const admin = require('firebase-admin')

const { OPEN_STEP, isWorkstream } = require('../Utils/HelperFunctionsCloud')
const { updateStatistics } = require('../Utils/statisticsHelper')

const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const buildCrossUserTaskStatusChange = (oldTask = {}, newTask = {}) => {
    if (!!oldTask.done === !!newTask.done) return null

    const marker = newTask.taskStatisticsTransition
    if (!marker?.id || marker.id === oldTask.taskStatisticsTransition?.id) return null

    const ownerId = newTask.userId || oldTask.userId
    const actorId = newTask.lastEditorId
    if (
        !ownerId ||
        !actorId ||
        marker.ownerId !== ownerId ||
        marker.actorId !== actorId ||
        actorId === ownerId ||
        isWorkstream(ownerId)
    ) {
        return null
    }

    const completing = !!newTask.done
    const sourceTask = completing ? newTask : oldTask
    const completed = Number.isFinite(sourceTask.completed) ? sourceTask.completed : marker.completed
    if (!Number.isFinite(completed)) return null

    return {
        ownerId,
        actorId,
        transitionId: marker.id,
        estimation: Number(sourceTask.estimations?.[OPEN_STEP]) || 0,
        subtract: !completing,
        completed,
    }
}

const persistCrossUserTaskStatusStatistics = async ({
    db = admin.firestore(),
    eventId,
    projectId,
    taskId,
    oldTask,
    newTask,
    now = Date.now(),
}) => {
    const change = buildCrossUserTaskStatusChange(oldTask, newTask)
    if (!change || !eventId || !projectId || !taskId) return false

    const projectSnapshot = await db.doc(`projects/${projectId}`).get()
    if (!projectSnapshot.exists || !(projectSnapshot.data()?.userIds || []).includes(change.ownerId)) return false

    const claimRef = db.doc(`taskStatisticsEvents/${eventId}`)
    return db.runTransaction(async transaction => {
        const claimSnapshot = await transaction.get(claimRef)
        if (claimSnapshot.exists) return false

        await updateStatistics(projectId, change.ownerId, change.estimation, change.subtract, false, change.completed, {
            db,
            set: (...args) => transaction.set(...args),
        })
        transaction.set(claimRef, {
            eventId,
            projectId,
            taskId,
            ownerId: change.ownerId,
            actorId: change.actorId,
            transitionId: change.transitionId,
            subtract: change.subtract,
            completed: change.completed,
            processedAt: now,
            expiresAt: new Date(now + CLAIM_RETENTION_MS),
        })
        return true
    })
}

module.exports = {
    buildCrossUserTaskStatusChange,
    persistCrossUserTaskStatusStatistics,
}
