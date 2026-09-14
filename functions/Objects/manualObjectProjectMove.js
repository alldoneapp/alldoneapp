'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const { HttpsError } = require('firebase-functions/v2/https')

const { assertObjectAccess, assertProjectAccess, getObjectDocPath } = require('../shared/privacyAccess')
const { moveObjectToDifferentProject } = require('../shared/moveObjectToDifferentProject')
const { getProjectMoveCollectionType, normalizeProjectMoveType } = require('../shared/projectMoveContract')

const REGION = 'europe-west1'
const WORKER_NAME = 'runManualObjectProjectMove'
const MAX_ATTEMPTS = 3

function getQueueResource() {
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

async function enqueueManualObjectProjectMove({ sourceProjectId, targetProjectId, objectType, objectId, actorId }) {
    const normalizedType = normalizeProjectMoveType(objectType)
    if (!sourceProjectId || !targetProjectId || !normalizedType || !objectId || !actorId) {
        throw new HttpsError('invalid-argument', 'A supported object type, project ids and object id are required')
    }
    if (sourceProjectId === targetProjectId) {
        return {
            queued: false,
            reason: 'already_in_target_project',
            sourceProjectId,
            targetProjectId,
            objectType: normalizedType,
            objectId,
        }
    }

    const requestId = crypto.randomUUID().replace(/-/g, '')
    const database = admin.firestore()
    const sourceRef = database.doc(
        getObjectDocPath(sourceProjectId, getProjectMoveCollectionType(normalizedType), objectId)
    )
    const requestedAt = Date.now()
    const marker = {
        requestId,
        sourceProjectId,
        targetProjectId,
        requestedByUserId: actorId,
        requestedAt,
        status: 'moving',
    }
    await sourceRef.set({ movingToOtherProjectId: targetProjectId, projectMove: marker }, { merge: true })

    try {
        await getFunctions()
            .taskQueue(getQueueResource())
            .enqueue(
                { requestId, sourceProjectId, targetProjectId, objectType: normalizedType, objectId, actorId },
                { id: `manual-object-move-${requestId}`, dispatchDeadlineSeconds: 300 }
            )
    } catch (error) {
        await sourceRef.set(
            { movingToOtherProjectId: null, projectMove: { ...marker, status: 'failed', failedAt: Date.now() } },
            { merge: true }
        )
        throw new HttpsError('unavailable', 'The project move could not be queued. Please try again.')
    }
    return { queued: true, requestId, sourceProjectId, targetProjectId, objectType: normalizedType, objectId }
}

async function runManualObjectProjectMove(payload) {
    const { sourceProjectId, targetProjectId, objectType, objectId, actorId } = payload
    const database = admin.firestore()
    await assertProjectAccess(database, actorId, targetProjectId)
    try {
        await assertObjectAccess(database, actorId, sourceProjectId, objectType, objectId)
    } catch (sourceError) {
        await assertObjectAccess(database, actorId, targetProjectId, objectType, objectId).catch(() => {
            throw sourceError
        })
    }
    return moveObjectToDifferentProject({ ...payload, database })
}

async function recordTerminalFailure(payload, error) {
    const { requestId, sourceProjectId, targetProjectId, objectType, objectId, actorId } = payload
    const database = admin.firestore()
    const collectionType = getProjectMoveCollectionType(objectType)
    const sourceRef = database.doc(getObjectDocPath(sourceProjectId, collectionType, objectId))
    const targetRef = database.doc(getObjectDocPath(targetProjectId, collectionType, objectId))
    const [sourceSnapshot, targetSnapshot] = await Promise.all([sourceRef.get(), targetRef.get()])
    const state = {
        requestId,
        sourceProjectId,
        targetProjectId,
        requestedByUserId: actorId,
        status: sourceSnapshot.exists ? 'failed' : 'completed',
        failedAt: Date.now(),
        failureCode: String(error?.code || 'internal').slice(0, 80),
    }
    const writes = []
    if (sourceSnapshot.exists)
        writes.push(sourceRef.set({ movingToOtherProjectId: null, projectMove: state }, { merge: true }))
    if (targetSnapshot.exists) writes.push(targetRef.set({ projectMove: state }, { merge: true }))
    await Promise.all(writes)
    return { recovered: !sourceSnapshot.exists && targetSnapshot.exists }
}

async function handleManualObjectProjectMoveDispatch(request) {
    try {
        return await runManualObjectProjectMove(request.data || {})
    } catch (error) {
        if ((request.retryCount || 0) >= MAX_ATTEMPTS - 1) {
            const status = await recordTerminalFailure(request.data || {}, error).catch(statusError => {
                console.error('Manual object move: failed to record terminal state', statusError)
                return { recovered: false }
            })
            if (status.recovered) return { moved: true, reason: 'destination_recovered_after_terminal_error' }
        }
        throw error
    }
}

module.exports = {
    MAX_ATTEMPTS,
    WORKER_NAME,
    enqueueManualObjectProjectMove,
    getQueueResource,
    handleManualObjectProjectMoveDispatch,
    recordTerminalFailure,
    runManualObjectProjectMove,
}
