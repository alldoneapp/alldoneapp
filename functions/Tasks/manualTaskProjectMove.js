'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const { HttpsError } = require('firebase-functions/v2/https')

const { assertObjectAccess, assertProjectAccess } = require('../shared/privacyAccess')
const { moveTaskToDifferentProject } = require('../shared/moveTaskToDifferentProject')

const REGION = 'europe-west1'
const WORKER_NAME = 'runManualTaskProjectMove'

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

module.exports = {
    WORKER_NAME,
    enqueueManualTaskProjectMove,
    getManualTaskMoveQueueResource,
    runManualTaskProjectMove,
}
