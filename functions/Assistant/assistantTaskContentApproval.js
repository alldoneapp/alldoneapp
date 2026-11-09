'use strict'

// Security audit 2026-11 (NEW-A): binds each activation of a project assistant task to the content
// its user approved. See assistantTaskContentHash.js for what "the content" is.
//
// An approval is written only here, by the server, in two ways:
//   1. From the write that shows the user approving: `onWriteAssistantTaskApprovalSecondGen`
//      (onDocumentWrittenWithAuthContext) sees WHO wrote. When that writer is activated after the
//      write AND either just activated it or just changed its content, the content of that write is
//      approved for them. So creating, editing or switching on a task approves it for its author,
//      and nobody else's write can approve anything for anybody but themselves.
//   2. Explicitly, through the `approveAssistantTaskContentSecondGen` callable, when a user confirms
//      a run whose content they had not approved (the confirmation shows them prompt, system
//      instruction and model). The callable takes the hash of what the user was shown and refuses
//      when the stored content no longer matches it, so a concurrent edit cannot ride along.
// A scheduled run compares the content it is about to execute with the activator's approved hash
// and does not run on a mismatch (assistantRecurringTasks.js).

const admin = require('firebase-admin')
const {
    APPROVED_CONTENT_HASH_FIELD,
    computeAssistantTaskContentHash,
    getApprovedContentHash,
    isGlobalAssistantTaskProject,
} = require('./assistantTaskContentHash')

const RECURRENCE_NEVER = 'never'
const RECURRENCE_ONCE = 'once'

// Mirrors getActivatedUserIdsForTask in assistantRecurringTasks.js (kept here so the trigger does
// not load the scheduler and its dependency tree).
function getActivatedUserIds(task) {
    const completedOneOffUserIds = new Set(task?.completedOneOffUserIds || [])
    const recurrenceByUser = task?.recurrenceByUser || {}
    const recurrenceUserIds = Object.entries(recurrenceByUser)
        .filter(
            ([userId, recurrence]) =>
                recurrence &&
                recurrence !== RECURRENCE_NEVER &&
                !(recurrence === RECURRENCE_ONCE && completedOneOffUserIds.has(userId))
        )
        .map(([userId]) => userId)
    const explicitIds = Array.isArray(task?.activatedUserIds)
        ? task.activatedUserIds.filter(userId => userId && !completedOneOffUserIds.has(userId))
        : []
    const merged = [...new Set([...recurrenceUserIds, ...explicitIds])]
    if (Array.isArray(task?.activatedUserIds) || task?.recurrenceByUser !== undefined) return merged
    if (!task?.recurrence || task.recurrence === RECURRENCE_NEVER) return []
    return [...new Set([task?.activatorUserId, task?.creatorUserId, task?.userId].filter(Boolean))]
}

/**
 * Decides whether one write approves the task's content for its writer. Pure.
 * Returns the hash to record for `authId`, or null.
 */
function resolveWriterApproval({ projectId, before, after, authType, authId }) {
    if (isGlobalAssistantTaskProject(projectId)) return null
    if (!after || authType !== 'app_user' || !authId) return null
    if (!getActivatedUserIds(after).includes(authId)) return null

    const afterHash = computeAssistantTaskContentHash(after)
    if (getApprovedContentHash(after, authId) === afterHash) return null

    const justActivated = !before || !getActivatedUserIds(before).includes(authId)
    const changedContent = !before || computeAssistantTaskContentHash(before) !== afterHash
    return justActivated || changedContent ? afterHash : null
}

async function recordWriterApprovalFromEvent({
    db = admin.firestore(),
    docPath,
    projectId,
    before,
    after,
    authType,
    authId,
}) {
    const hash = resolveWriterApproval({ projectId, before, after, authType, authId })
    if (!hash) return { approved: false }

    const ref = db.doc(docPath)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return { approved: false, reason: 'deleted' }
        const current = snapshot.data()
        // A later write already changed the content again: that write's own event decides.
        if (computeAssistantTaskContentHash(current) !== hash) return { approved: false, reason: 'superseded' }
        if (getApprovedContentHash(current, authId) === hash) return { approved: false, reason: 'already' }
        transaction.update(ref, { [`${APPROVED_CONTENT_HASH_FIELD}.${authId}`]: hash })
        return { approved: true, hash }
    })
}

class ApprovalError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isPathSegment = value => isNonEmptyString(value) && !value.includes('/') && value.length <= 200

/**
 * The callable's work: approve the current content of one task for the caller, provided it is the
 * content the caller was shown (`expectedHash`).
 */
async function approveAssistantTaskContent({
    db = admin.firestore(),
    userId,
    projectId,
    assistantId,
    taskId,
    expectedHash,
}) {
    if (!isNonEmptyString(userId)) throw new ApprovalError('unauthenticated', 'Sign in to approve a task.')
    if (![projectId, assistantId, taskId].every(isPathSegment) || !isNonEmptyString(expectedHash)) {
        throw new ApprovalError('invalid-argument', 'projectId, assistantId, taskId and expectedHash are required.')
    }
    if (isGlobalAssistantTaskProject(projectId)) return { approved: true, hash: expectedHash, global: true }

    const projectSnapshot = await db.doc(`projects/${projectId}`).get()
    const userIds = projectSnapshot.exists ? projectSnapshot.data()?.userIds : null
    if (!Array.isArray(userIds) || !userIds.includes(userId)) {
        throw new ApprovalError('permission-denied', 'You are not a member of this project.')
    }

    const candidates = [
        db.doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`),
        db.doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`),
    ]
    return db.runTransaction(async transaction => {
        for (const ref of candidates) {
            const snapshot = await transaction.get(ref)
            if (!snapshot.exists) continue
            const task = snapshot.data()
            if (ref.path.includes('/preConfigTasks/') && task.assistantId && task.assistantId !== assistantId) continue
            const hash = computeAssistantTaskContentHash(task)
            if (hash !== expectedHash) {
                throw new ApprovalError(
                    'failed-precondition',
                    'The task changed while you were looking at it. Review it again.'
                )
            }
            if (getApprovedContentHash(task, userId) !== hash) {
                transaction.update(ref, { [`${APPROVED_CONTENT_HASH_FIELD}.${userId}`]: hash })
            }
            return { approved: true, hash }
        }
        throw new ApprovalError('not-found', 'The task no longer exists.')
    })
}

/**
 * The scheduler's question: may this run go ahead for this user? Pure.
 */
function evaluateScheduledRunApproval(task, userId, taskProjectId) {
    if (isGlobalAssistantTaskProject(taskProjectId)) return { approved: true }
    const hash = computeAssistantTaskContentHash(task)
    return { approved: getApprovedContentHash(task, userId) === hash, hash }
}

/**
 * One-time backfill (migration/approveExistingAssistantTaskContent.js): approves the CURRENT content
 * for every user activated today, so nothing stops on deploy. Pure; returns the update or null.
 */
function buildBackfillApprovalUpdate(task, projectId) {
    if (isGlobalAssistantTaskProject(projectId) || !task) return null
    const hash = computeAssistantTaskContentHash(task)
    const update = {}
    getActivatedUserIds(task).forEach(userId => {
        if (getApprovedContentHash(task, userId) !== hash) update[`${APPROVED_CONTENT_HASH_FIELD}.${userId}`] = hash
    })
    return Object.keys(update).length > 0 ? update : null
}

module.exports = {
    ApprovalError,
    buildBackfillApprovalUpdate,
    getActivatedUserIds,
    resolveWriterApproval,
    recordWriterApprovalFromEvent,
    approveAssistantTaskContent,
    evaluateScheduledRunApproval,
}
