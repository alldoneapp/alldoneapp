'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const { HttpsError } = require('firebase-functions/v2/https')

const { assertObjectAccess, assertProjectAccess } = require('../shared/privacyAccess')
const { moveTaskToDifferentProject } = require('../shared/moveTaskToDifferentProject')

const REGION = 'europe-west1'
const WORKER_NAME = 'runManualTaskProjectMove'
const MAX_ATTEMPTS = 3

function getManualTaskMoveQueueResource() {
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return admin.app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    return projectId ? `locations/${REGION}/functions/${WORKER_NAME}` : WORKER_NAME
}

async function enqueueManualTaskProjectMove({ sourceProjectId, targetProjectId, taskId, actorId }) {
    if (!sourceProjectId || !targetProjectId || !taskId || !actorId) {
        throw new Error('sourceProjectId, targetProjectId, taskId and actorId are required')
    }
    if (sourceProjectId === targetProjectId) {
        return { queued: false, reason: 'already_in_target_project', sourceProjectId, targetProjectId, taskId }
    }

    const requestId = crypto.randomUUID().replace(/-/g, '')
    const queue = getFunctions().taskQueue(getManualTaskMoveQueueResource())
    try {
        await queue.enqueue(
            { requestId, sourceProjectId, targetProjectId, taskId, actorId },
            { id: `manual-task-move-${requestId}`, dispatchDeadlineSeconds: 300 }
        )
    } catch (error) {
        console.error('Manual task project move: Failed to enqueue worker', {
            requestId,
            sourceProjectId,
            targetProjectId,
            taskId,
            actorId,
            code: error?.code || '',
            message: error?.message || '',
        })
        throw new HttpsError('unavailable', 'The task move could not be queued. Please try again.', {
            requestId,
            causeCode: error?.code || '',
        })
    }
    return { queued: true, requestId, sourceProjectId, targetProjectId, taskId }
}

async function runManualTaskProjectMove({ requestId, sourceProjectId, targetProjectId, taskId, actorId }) {
    if (!requestId || !sourceProjectId || !targetProjectId || !taskId || !actorId) {
        throw new Error('Invalid manual task move payload')
    }

    const database = admin.firestore()
    await assertProjectAccess(database, actorId, targetProjectId)
    try {
        await assertObjectAccess(database, actorId, sourceProjectId, 'tasks', taskId)
    } catch (sourceAccessError) {
        // A retry can arrive after the first attempt deleted the source. The
        // completed target remains the authority in that case; this still
        // checks the actor against the moved task before treating it as done.
        try {
            await assertObjectAccess(database, actorId, targetProjectId, 'tasks', taskId)
        } catch (_) {
            throw sourceAccessError
        }
    }

    const [sourceProjectSnapshot, targetProjectSnapshot, actorSnapshot] = await Promise.all([
        database.doc(`projects/${sourceProjectId}`).get(),
        database.doc(`projects/${targetProjectId}`).get(),
        database.doc(`users/${actorId}`).get(),
    ])
    if (!sourceProjectSnapshot.exists || !targetProjectSnapshot.exists) throw new Error('Move project not found')

    const actor = actorSnapshot.exists ? actorSnapshot.data() || {} : {}
    return moveTaskToDifferentProject({
        database,
        sourceProjectId,
        targetProjectId,
        taskId,
        editorId: actorId,
        editorName: actor.displayName || '',
        manual: true,
        requestId,
        sourceProject: { id: sourceProjectId, ...(sourceProjectSnapshot.data() || {}) },
        targetProject: { id: targetProjectId, ...(targetProjectSnapshot.data() || {}) },
    })
}

async function recordManualTaskMoveFailure({ requestId, sourceProjectId, targetProjectId, taskId, actorId }, error) {
    const database = admin.firestore()
    const sourceRef = database.doc(`items/${sourceProjectId}/tasks/${taskId}`)
    const targetRef = database.doc(`items/${targetProjectId}/tasks/${taskId}`)
    const [sourceSnapshot, targetSnapshot] = await Promise.all([sourceRef.get(), targetRef.get()])
    const failedMove = {
        requestId,
        sourceProjectId,
        targetProjectId,
        requestedByUserId: actorId,
        status: 'failed',
        failedAt: Date.now(),
        failureCode: String(error?.code || 'internal').slice(0, 80),
    }
    if (!sourceSnapshot.exists && targetSnapshot.exists) {
        await targetRef.update({
            projectMove: {
                ...failedMove,
                status: 'completed',
                completedAt: Date.now(),
            },
        })
        return { recovered: true }
    }
    const updates = []
    if (sourceSnapshot.exists) updates.push(sourceRef.update({ projectMove: failedMove }))
    if (targetSnapshot.exists) updates.push(targetRef.update({ projectMove: failedMove }))
    await Promise.all(updates)
    return { recovered: false }
}

async function handleManualTaskProjectMoveDispatch(request) {
    try {
        return await runManualTaskProjectMove(request.data || {})
    } catch (error) {
        if ((request.retryCount || 0) >= MAX_ATTEMPTS - 1) {
            try {
                const status = await recordManualTaskMoveFailure(request.data || {}, error)
                if (status.recovered) {
                    return { moved: true, reason: 'destination_recovered_after_terminal_error' }
                }
            } catch (statusError) {
                console.error('Manual task project move: Failed to record terminal failure', {
                    requestId: request.data?.requestId,
                    sourceProjectId: request.data?.sourceProjectId,
                    targetProjectId: request.data?.targetProjectId,
                    taskId: request.data?.taskId,
                    code: statusError?.code || '',
                    message: statusError?.message || '',
                })
            }
        }
        throw error
    }
}

module.exports = {
    MAX_ATTEMPTS,
    WORKER_NAME,
    enqueueManualTaskProjectMove,
    getManualTaskMoveQueueResource,
    handleManualTaskProjectMoveDispatch,
    recordManualTaskMoveFailure,
    runManualTaskProjectMove,
}
