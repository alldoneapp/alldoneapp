'use strict'

const { createHash } = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const { getObjectDocPath, canAccessObject } = require('../shared/privacyAccess')
const {
    acquireAssistantRunLock,
    completeAssistantRunLock,
    failAssistantRunLock,
    cancelAssistantRunLock,
    isAssistantRunCancelledError,
} = require('./assistantRunIdempotency')
const { HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('./assistantRunLimits')

const COMMENT_OBJECT_TYPES = new Set(['tasks', 'topics', 'notes', 'goals', 'contacts', 'users', 'skills', 'assistants'])

function isReplyCandidate(comment) {
    return (
        comment?.fromAssistant === true &&
        !!comment.creatorId &&
        typeof comment.commentText === 'string' &&
        !!comment.commentText.trim() &&
        !comment.assistantRun &&
        !comment.suppressAssistantReply
    )
}

async function resolveCommentReply(db, { projectId, objectType, objectId, commentId }) {
    if (!projectId || !objectId || !commentId || !COMMENT_OBJECT_TYPES.has(objectType)) return null
    const [objectDoc, commentDoc, projectDoc] = await Promise.all([
        db.doc(getObjectDocPath(projectId, objectType, objectId)).get(),
        db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`).get(),
        db.doc(`projects/${projectId}`).get(),
    ])
    if (!objectDoc.exists || !commentDoc.exists || !projectDoc.exists) return null
    const object = objectDoc.data() || {}
    const comment = commentDoc.data() || {}
    const assistantId = objectType === 'assistants' ? objectId : object.assistantId
    if (!isReplyCandidate(comment) || object.isAssistantEnabled !== true || !assistantId) return null
    // A thread's assistant must never answer its own output, including unmarked legacy output.
    if (comment.creatorId === assistantId || (objectType === 'tasks' && object.taskMetadata?.isWebhookTask)) return null

    // Tool comments carry the human requester. Legacy/background comments may fall back to
    // the object's owner, but never to an arbitrary follower or the authoring assistant.
    const userId =
        comment.requestUserId ||
        (objectType === 'users' ? objectId : object.userId || object.creatorId || object.recorderUserId)
    if (!userId || !(projectDoc.data()?.userIds || []).includes(userId)) return null
    const userDoc = await db.doc(`users/${userId}`).get()
    if (!userDoc.exists) return null
    const isPublicFor = objectType === 'assistants' ? [0] : object.isPublicFor || []
    if (!canAccessObject({ isPublicFor }, userId)) return null
    const followersDoc = await db.doc(`followers/${projectId}/${objectType}/${objectId}`).get()
    const followerIds = (followersDoc.data()?.usersFollowing || []).filter(
        id => (projectDoc.data()?.userIds || []).includes(id) && canAccessObject({ isPublicFor }, id)
    )
    return { userId, assistantId, isPublicFor, followerIds, language: userDoc.data()?.language || 'en' }
}

async function enqueueAssistantCommentReply(params, { db = admin.firestore(), queue } = {}) {
    const reply = await resolveCommentReply(db, params)
    if (!reply) return { skipped: true }
    const id = `comment-${createHash('sha256')
        .update(JSON.stringify([params.projectId, params.objectType, params.objectId, params.commentId]))
        .digest('hex')}`
    const workerQueue = queue || getFunctions().taskQueue('locations/europe-west1/functions/runAssistantCommentReply')
    try {
        await workerQueue.enqueue({ ...params, assistantId: reply.assistantId }, { id, dispatchDeadlineSeconds: 1800 })
        return { enqueued: true }
    } catch (error) {
        if (['functions/task-already-exists', 'already-exists', 6].includes(error?.code)) return { duplicate: true }
        throw error
    }
}

async function runAssistantCommentReply(params, { db = admin.firestore(), askToBot } = {}) {
    // Settings, access, author and comment existence are checked again after queueing.
    const reply = await resolveCommentReply(db, params)
    if (!reply || reply.assistantId !== params.assistantId) return { skipped: true }
    const lock = await acquireAssistantRunLock(db, {
        ...params,
        ...reply,
        messageId: params.commentId,
        retryFailed: false,
    })
    if (!lock.acquired) return { duplicate: true }
    try {
        const ask = askToBot || require('./assistantNormalTalk_optimized').askToOpenAIBot
        await ask(
            reply.userId,
            params.commentId,
            params.projectId,
            params.objectType,
            params.objectId,
            [...new Set([...reply.followerIds, reply.userId])],
            reply.isPublicFor,
            reply.language,
            reply.assistantId,
            reply.followerIds,
            Date.now(),
            lock.lockId,
            {
                automaticCommentReply: true,
                maxRunWallClockMs: HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS,
            }
        )
        await completeAssistantRunLock(lock.lockRef)
        return { completed: true }
    } catch (error) {
        if (isAssistantRunCancelledError(error)) {
            await cancelAssistantRunLock(lock.lockRef)
            return { cancelled: true }
        }
        await failAssistantRunLock(lock.lockRef, error)
        throw error
    }
}

module.exports = { isReplyCandidate, resolveCommentReply, enqueueAssistantCommentReply, runAssistantCommentReply }
