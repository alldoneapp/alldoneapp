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

// A request no client of the sender will start (MCP ask_assistant, AT-3059): the server is its only
// runner, so there is no grace period to wait for, and no client run whose answer could be a newer
// assistant comment in the thread.
const isServerStartedRequest = comment => comment?.assistantRunRequest?.startOnServer === true

// Newest comments the check looks through for a later user message, for a server-started request.
// Automatic assistant comments (goal routing, VM status, heartbeats) can land right after a question
// asked in a fresh task and must not make it look answered.
const SUPERSEDED_LOOKBACK = 20

// Why a check did not start the run, kept on the question for whoever waits for its answer
// (MCP ask_assistant reads it; a run lock always wins over it). Bounded and best effort.
const MAX_SKIP_DETAIL_LENGTH = 300

// `delaySeconds: 0` starts the run at once, for a message whose sender asked the server to answer it
// (MCP ask_assistant). The comment trigger enqueues the same task id at once too for such a request,
// so whichever of the two comes first starts it and the other is a duplicate, never a 90s wait.
async function enqueueMissedAssistantRunCheck(params, comment, { queue, now = Date.now, delaySeconds } = {}) {
    if (delaySeconds === undefined) delaySeconds = isServerStartedRequest(comment) ? 0 : MISSED_RUN_GRACE_SECONDS
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
            { id, scheduleDelaySeconds: delaySeconds, dispatchDeadlineSeconds: 1800 }
        )
        return { enqueued: true }
    } catch (error) {
        if (['functions/task-already-exists', 'already-exists', 6].includes(error?.code)) return { duplicate: true }
        throw error
    }
}

// Any newer comment counts for a request a client was meant to start, as before: an answer whose run
// took no lock must not be answered twice. For a server-started request only a newer user message
// counts, since nothing else can have answered it.
function isSuperseded(newestDocs, commentId, serverStarted) {
    for (const doc of (serverStarted ? newestDocs : newestDocs.slice(0, 1)) || []) {
        if (doc.id === commentId) return false
        if (!serverStarted || (doc.data() || {}).fromAssistant !== true) return true
    }
    return false
}

// Only an existing comment is marked: `update` never creates a deleted question again.
async function recordSkippedRun(db, { projectId, objectType, objectId, commentId }, reason, now, detail = '') {
    try {
        await db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`).update({
            assistantRunSkipped: {
                reason,
                at: now,
                ...(detail ? { detail: String(detail).slice(0, MAX_SKIP_DETAIL_LENGTH) } : {}),
            },
        })
    } catch (error) {
        if (reason !== 'missing') {
            console.warn('[assistantMissedRun] Could not record why the run did not start', {
                projectId,
                objectType,
                objectId,
                commentId,
                reason,
                error: error?.message,
            })
        }
    }
}

async function resolveMissedRun(db, params, now) {
    const { projectId, objectType, objectId, commentId } = params
    const commentsPath = `chatComments/${projectId}/${objectType}/${objectId}/comments`
    const [objectDoc, commentDoc, newestSnapshot] = await Promise.all([
        db.doc(getObjectDocPath(projectId, objectType, objectId)).get(),
        db.doc(`${commentsPath}/${commentId}`).get(),
        db.collection(commentsPath).orderBy('created', 'desc').limit(SUPERSEDED_LOOKBACK).get(),
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
    if (isSuperseded(newestSnapshot.docs, commentId, isServerStartedRequest(comment))) return { skipped: 'superseded' }

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

    // The task runs once (maxAttempts: 1), so a check that ends without a lock is final for this
    // message. Saying why on the question is what lets a waiting caller stop waiting.
    let resolution
    let lock
    try {
        resolution = await resolveMissedRun(db, location, now())
        if (!resolution.run) {
            await recordSkippedRun(db, location, resolution.skipped, now())
            return { skipped: resolution.skipped }
        }
        // Failed and cancelled runs are final here: the user saw them, and a cancel is a decision.
        lock = await acquireAssistantRunLock(db, {
            projectId,
            objectType,
            objectId,
            messageId: commentId,
            userId: resolution.run.userId,
            assistantId: resolution.run.assistantId,
            retryFailed: false,
        })
    } catch (error) {
        await recordSkippedRun(db, location, 'error', now(), error?.message || error)
        throw error
    }
    if (!lock.acquired) return { alreadyStarted: true }
    const { userId, assistantId, isPublicFor, followerIds, language, ageMs } = resolution.run

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
