'use strict'

const { createHash } = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const {
    FEED_PUBLIC_FOR_ALL,
    assertObjectAccess,
    canAccessObject,
    getObjectDocPath,
} = require('../shared/privacyAccess')
const {
    acquireAssistantRunLock,
    buildAssistantRunLockId,
    cancelAssistantRunLock,
    completeAssistantRunLock,
    failAssistantRunLock,
    isAssistantRunCancelledError,
} = require('./assistantRunIdempotency')
const { HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('./assistantRunLimits')
const { COMMENT_OBJECT_TYPES } = require('./assistantCommentReply')

// A user's message reaches the assistant only through the sender's own browser: the client writes the
// comment, then calls askToBotSecondGen without awaiting it. When the page goes away in between - a
// phone discarding the tab while the callable cold-starts, a reload, a closed laptop - the comment is
// stored and nothing ever answers it, with no error anywhere. The client therefore marks the comment
// it is about to run (`assistantRunRequest`), and the comment trigger schedules this check. The
// per-message run lock is the evidence: the client's run takes it before doing anything, so a lock
// that still does not exist after the grace period means the run never started.
const MISSED_RUN_TASK_KIND = 'missed_user_run'

// The client's request normally lands within seconds, and even through a cold start (8-15s measured)
// well inside this. A request that arrives after the catch-up started meets its lock and is skipped.
const MISSED_RUN_GRACE_SECONDS = 90

// Bounds a trigger redelivered days later. A comment the outbox delivers late is still answered by the
// client itself, which calls askToBot right after the delivery.
const MISSED_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000

const isFreshComment = (comment, now) => {
    const created = Number(comment?.created)
    return Number.isFinite(created) && now - created <= MISSED_RUN_MAX_AGE_MS
}

// The request records where it was made. A comment copied with its thread into another project or
// object keeps the field, and must not be answered a second time at its new address.
function isMissedRunCandidate(comment, { projectId, objectType, objectId }) {
    const request = comment?.assistantRunRequest
    return (
        comment?.fromAssistant !== true &&
        !!comment.creatorId &&
        typeof comment.commentText === 'string' &&
        !!comment.commentText.trim() &&
        !!request &&
        typeof request === 'object' &&
        request.projectId === projectId &&
        request.objectType === objectType &&
        request.objectId === objectId
    )
}

const isMissedAssistantRunTask = data => data?.kind === MISSED_RUN_TASK_KIND

async function enqueueMissedAssistantRunCheck(params, comment, { queue, now = Date.now } = {}) {
    const { projectId, objectType, objectId, commentId } = params
    if (!projectId || !objectId || !commentId || !COMMENT_OBJECT_TYPES.has(objectType)) return { skipped: true }
    if (!isMissedRunCandidate(comment, params) || !isFreshComment(comment, now())) return { skipped: true }

    const id = `missed-run-${createHash('sha256')
        .update(JSON.stringify([projectId, objectType, objectId, commentId]))
        .digest('hex')}`
    // Same worker and queue as the automatic comment replies, so no new IAM grant is needed.
    const workerQueue = queue || getFunctions().taskQueue('locations/europe-west1/functions/runAssistantCommentReply')
    try {
        await workerQueue.enqueue(
            { kind: MISSED_RUN_TASK_KIND, projectId, objectType, objectId, commentId },
            { id, scheduleDelaySeconds: MISSED_RUN_GRACE_SECONDS, dispatchDeadlineSeconds: 1800 }
        )
        return { enqueued: true }
    } catch (error) {
        if (['functions/task-already-exists', 'already-exists', 6].includes(error?.code)) return { duplicate: true }
        throw error
    }
}

async function resolveMissedRun(db, params, now) {
    const { projectId, objectType, objectId, commentId } = params
    const commentsPath = `chatComments/${projectId}/${objectType}/${objectId}/comments`
    const [objectDoc, commentDoc, newestSnapshot] = await Promise.all([
        db.doc(getObjectDocPath(projectId, objectType, objectId)).get(),
        db.doc(`${commentsPath}/${commentId}`).get(),
        db.collection(commentsPath).orderBy('created', 'desc').limit(1).get(),
    ])
    if (!objectDoc.exists || !commentDoc.exists) return { skipped: 'missing' }
    const object = objectDoc.data() || {}
    const comment = commentDoc.data() || {}
    if (!isMissedRunCandidate(comment, params)) return { skipped: 'not_requested' }
    if (!isFreshComment(comment, now)) return { skipped: 'too_old' }
    if (object.isAssistantEnabled === false || (objectType === 'tasks' && object.taskMetadata?.isWebhookTask)) {
        return { skipped: 'assistant_disabled' }
    }
    // A later message in the thread replaces this one: either its own run answered with this message
    // in its history, or it is caught up itself and answers both at once.
    const newestId = newestSnapshot.docs[0]?.id
    if (newestId && newestId !== commentId) return { skipped: 'superseded' }

    const assistantId =
        comment.assistantRunRequest.assistantId || (objectType === 'assistants' ? objectId : object.assistantId)
    if (!assistantId) return { skipped: 'no_assistant' }

    // The sender pays and is answered, exactly as with their own askToBot call. The rules only let a
    // client create a comment authored as itself, and the access check is the callable's own.
    const userId = comment.creatorId
    try {
        await assertObjectAccess(db, userId, projectId, objectType, objectId)
    } catch (error) {
        return { skipped: 'no_access' }
    }
    const [userDoc, projectDoc, followersDoc] = await Promise.all([
        db.doc(`users/${userId}`).get(),
        db.doc(`projects/${projectId}`).get(),
        db.doc(`followers/${projectId}/${objectType}/${objectId}`).get(),
    ])
    const memberIds = projectDoc.data()?.userIds || []
    const isPublicFor = Array.isArray(object.isPublicFor) ? object.isPublicFor : [FEED_PUBLIC_FOR_ALL]
    const followerIds = (followersDoc.data()?.usersFollowing || []).filter(
        id => memberIds.includes(id) && canAccessObject({ isPublicFor }, id)
    )
    return {
        run: {
            userId,
            assistantId,
            isPublicFor,
            followerIds,
            language: userDoc.data()?.language || 'en',
            ageMs: now - Number(comment.created),
        },
    }
}

async function runMissedAssistantRun(params, { db = admin.firestore(), askToBot, now = Date.now } = {}) {
    const { projectId, objectType, objectId, commentId } = params || {}
    if (!projectId || !objectId || !commentId || !COMMENT_OBJECT_TYPES.has(objectType)) return { skipped: true }
    const location = { projectId, objectType, objectId, commentId }

    // The ordinary outcome: the sender's client started the run, whatever became of it. One read.
    const lockId = buildAssistantRunLockId({ projectId, objectType, objectId, messageId: commentId })
    if ((await db.doc(`assistantRunLocks/${lockId}`).get()).exists) return { alreadyStarted: true }

    const resolution = await resolveMissedRun(db, location, now())
    if (!resolution.run) return { skipped: resolution.skipped }
    const { userId, assistantId, isPublicFor, followerIds, language, ageMs } = resolution.run

    // Failed and cancelled runs are final here: the user saw them, and a cancel is a decision.
    const lock = await acquireAssistantRunLock(db, {
        projectId,
        objectType,
        objectId,
        messageId: commentId,
        userId,
        assistantId,
        retryFailed: false,
    })
    if (!lock.acquired) return { alreadyStarted: true }

    console.warn('[assistantMissedRun] The sender never started the assistant run; starting it from the server', {
        projectId,
        objectType,
        objectId,
        commentId,
        assistantId,
        ageMs,
    })
    try {
        const ask = askToBot || require('./assistantNormalTalk_optimized').askToOpenAIBot
        await ask(
            userId,
            commentId,
            projectId,
            objectType,
            objectId,
            [...new Set([...followerIds, userId])],
            isPublicFor,
            language,
            assistantId,
            followerIds,
            Date.now(),
            lock.lockId,
            { maxRunWallClockMs: HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS }
        )
        await completeAssistantRunLock(lock.lockRef)
        return { caughtUp: true }
    } catch (error) {
        if (isAssistantRunCancelledError(error)) {
            await cancelAssistantRunLock(lock.lockRef)
            return { cancelled: true }
        }
        await failAssistantRunLock(lock.lockRef, error)
        throw error
    }
}

module.exports = {
    MISSED_RUN_GRACE_SECONDS,
    MISSED_RUN_MAX_AGE_MS,
    MISSED_RUN_TASK_KIND,
    isMissedRunCandidate,
    isMissedAssistantRunTask,
    enqueueMissedAssistantRunCheck,
    runMissedAssistantRun,
}
