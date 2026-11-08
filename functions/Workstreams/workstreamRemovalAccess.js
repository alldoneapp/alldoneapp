'use strict'

/**
 * Guards `onRemoveWorkstreamSecondGen` (security audit 2026-11).
 *
 * `onRemoveWorkstream` rewrites `userId`, `currentReviewerId`, `userIds` and `isPublicFor` of every
 * task and goal that names the stream, with the Admin SDK. The callable used to run it for any
 * `projectId`/`streamId` pair a signed-in caller named, so any account could re-scope another
 * project's tasks, or "remove" a user id (or `ws@default`) as if it were a workstream.
 *
 * The client (`deleteWorkstream`) calls it as a project member, before its own batch deletes the
 * workstream document, so the stream still exists when this check runs.
 */

const { HttpsError } = require('firebase-functions/v2/https')
const { assertProjectAccess } = require('../shared/privacyAccess')

const WORKSTREAM_ID_PREFIX = 'ws@'
const DEFAULT_WORKSTREAM_ID = 'ws@default'

async function assertWorkstreamRemovalAllowed(db, request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')

    const { projectId, streamId } = request.data || {}
    if (typeof projectId !== 'string' || !projectId || typeof streamId !== 'string' || !streamId) {
        throw new HttpsError('invalid-argument', 'projectId and streamId are required')
    }

    try {
        await assertProjectAccess(db, uid, projectId)
    } catch (error) {
        throw new HttpsError('permission-denied', 'No access to project')
    }

    if (!streamId.startsWith(WORKSTREAM_ID_PREFIX) || streamId === DEFAULT_WORKSTREAM_ID || streamId.includes('/')) {
        throw new HttpsError('invalid-argument', 'Unknown workstream')
    }
    const workstreamDoc = await db.doc(`projectsWorkstreams/${projectId}/workstreams/${streamId}`).get()
    if (!workstreamDoc.exists) {
        throw new HttpsError('invalid-argument', 'Unknown workstream')
    }

    return { uid, projectId, streamId }
}

module.exports = { assertWorkstreamRemovalAllowed }
