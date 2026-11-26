'use strict'

// AT-3165: an email task stars its Gmail message while the task is open (decided with Karsten
// 2026-11-26).
//
// - The server sets the star right after it CREATED the task (email line "Create task", the unread
//   row action that uses it, and the labeling run's create_task). Only on exactly the message the
//   task was created from, and only on the mailbox the task was created from.
// - The star goes away only when the task reaches Done (`inDone` turns true). A workflow step on
//   the way is not Done. Reopening puts the star back. Deleting the task removes it too.
// - A star the message already had before the task existed is the user's own: Alldone never removes
//   it (state `preexisting`).
//
// Why a registry: `gmailData` on a task is not bound to its writer in firestore.rules, so a project
// member could write another member's `accountUserId` and message id onto a task. The task triggers
// therefore never act on `gmailData` alone. They act only on what the server itself recorded when it
// set the star, in the MAILBOX OWNER's tree: `users/{uid}/gmailTaskStars/{taskId}` (server-owned in
// firestore.rules). The task's `gmailData.accountUserId` only says where to look; the message id and
// the connection come from the registry.
//
// Stars the user sets in Gmail (AT-3165 follow-up, Gmail/gmailStarTaskImport.js): a star that makes
// Alldone create (or reopen) a task belongs to that task (decided with Karsten 2026-11-26): it is
// recorded with `wasStarredBefore: false` and `origin: 'gmail_star'`, so Done removes it and
// reopening puts it back, like a star Alldone set itself. A star that was there before a task was
// created by a button stays the user's own (`preexisting`), as before.
//
// `doneHistoryId`: the mailbox historyId read right after the task reached Done. A star event the
// import sees later with a history record id at or below it happened before Done (Alldone's own
// star while the task was open, or the user's star that led to the task) and never reopens it.
//
// Gmail is touched with messages.modify on that one message, adding/removing STARRED only. INBOX,
// UNREAD and every other label stay as they are, so archiving (on completion or on postponing,
// AT-3164) is untouched.

const admin = require('firebase-admin')

const STAR_LABEL = 'STARRED'
const REGISTRY_COLLECTION = 'gmailTaskStars'

const STATE_PENDING = 'pending' // recorded, the star call not confirmed yet (retried on the next chance)
const STATE_STARRED = 'starred' // Alldone set the star; removed on Done/delete
const STATE_PREEXISTING = 'preexisting' // the message was starred before the task; never touched
const STATE_REMOVED = 'removed' // Alldone removed the star on Done (reopen stars again)
const STATE_DELETED = 'deleted' // the task was deleted; terminal
const STATE_MISSING = 'missing' // the message no longer exists in the mailbox; terminal

const ACTIVE_STATES = new Set([STATE_PENDING, STATE_STARRED])
const ORIGIN_GMAIL_STAR = 'gmail_star' // the user's own Gmail star created or reopened the task
const GMAIL_RETRY_DELAY_MS = 400

function trimString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function defaultWithGmail(userId, connectionKey, run) {
    return require('../Email/emailLine/gmailEmailLine').withGmailClient(userId, connectionKey, run)
}

function getRegistryRef(database, userId, taskId) {
    return database.collection('users').doc(userId).collection(REGISTRY_COLLECTION).doc(taskId)
}

function isMessageNotFoundError(error) {
    if (error?.code === 404 || error?.response?.status === 404) return true
    const message = String(error?.message || '')
    return message.includes('Requested entity was not found') || message.includes('Not Found')
}

function isTransientGmailError(error) {
    const status = Number(error?.code || error?.status || error?.response?.status)
    if ([429, 500, 502, 503, 504].includes(status)) return true
    const message = String(error?.message || '').toLowerCase()
    return (
        message.includes('rate limit') ||
        message.includes('backend error') ||
        message.includes('temporarily unavailable') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('etimedout')
    )
}

// One retry on a transient Gmail error. Both calls are idempotent (adding or removing a label that
// is or is not there is a no-op), so running one twice is safe.
async function withTransientRetry(operation, { delayMs = GMAIL_RETRY_DELAY_MS } = {}) {
    try {
        return await operation()
    } catch (error) {
        if (!isTransientGmailError(error)) throw error
        await new Promise(resolve => setTimeout(resolve, delayMs))
        return operation()
    }
}

/**
 * True when the task document points at a Gmail (not Outlook) mailbox through a mailbox owner.
 * A cheap filter only: the triggers never trust these fields beyond choosing where to look.
 */
function isGmailEmailTask(task) {
    const gmailData = task?.gmailData
    if (!gmailData || typeof gmailData !== 'object') return false
    if (!trimString(gmailData.accountUserId) || !trimString(gmailData.messageId)) return false
    return trimString(gmailData.provider).toLowerCase() !== 'microsoft'
}

async function readMessageIsStarred(withGmail, userId, connectionKey, messageId) {
    const response = await withTransientRetry(() =>
        withGmail(userId, connectionKey, gmail =>
            gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' })
        )
    )
    const labelIds = Array.isArray(response?.data?.labelIds) ? response.data.labelIds : []
    return labelIds.includes(STAR_LABEL)
}

async function modifyStar(withGmail, userId, connectionKey, messageId, starred) {
    const requestBody = starred ? { addLabelIds: [STAR_LABEL] } : { removeLabelIds: [STAR_LABEL] }
    await withTransientRetry(() =>
        withGmail(userId, connectionKey, gmail =>
            gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody })
        )
    )
}

// The other open stars Alldone holds on the same message of the same mailbox (another task created
// from the same email). The star belongs to all of them: the first one done must not take it away
// from the others. A single-field equality query on the owner's own registry; no index needed.
async function findOtherActiveEntries(database, userId, entry, taskId) {
    const snapshot = await database
        .collection('users')
        .doc(userId)
        .collection(REGISTRY_COLLECTION)
        .where('messageId', '==', entry.messageId)
        .get()
    const others = []
    snapshot.forEach(doc => {
        if (doc.id === taskId) return
        const data = doc.data() || {}
        if (data.connectionKey !== entry.connectionKey) return
        if (!ACTIVE_STATES.has(data.state)) return
        others.push({ ...data, taskId: doc.id })
    })
    return others
}

async function isTaskOpen(database, projectId, taskId) {
    if (!projectId || !taskId) return false
    const snapshot = await database.doc(`items/${projectId}/tasks/${taskId}`).get()
    if (!snapshot.exists) return false
    return (snapshot.data() || {}).inDone !== true
}

async function anotherOpenTaskHoldsStar(database, userId, entry, taskId) {
    const others = await findOtherActiveEntries(database, userId, entry, taskId)
    for (const other of others) {
        if (await isTaskOpen(database, other.projectId, other.taskId)) return true
    }
    return false
}

async function writeEntry(ref, data) {
    await ref.set({ ...data, updatedAt: Date.now() }, { merge: true })
}

/**
 * Stars the Gmail message a task was just created from. Call only for a task the server created
 * itself in this request (not for an existing or continued one). Idempotent per task: a retry of
 * the same creation, or a second call, never stars twice or forgets that the star was the user's.
 *
 * Never throws: the task already exists, and a failed star must not fail its creation. A failure
 * leaves the entry `pending`, and `resumePendingTaskEmailStar` finishes it the next time the user
 * asks for a task for that email.
 */
async function starEmailOfCreatedTask(
    {
        userId,
        connectionKey,
        gmailEmail = '',
        messageId,
        threadId = '',
        projectId,
        taskId,
        provider = 'google',
        adoptExistingStar = false,
    },
    { database = admin.firestore(), withGmail = defaultWithGmail } = {}
) {
    const normalizedUserId = trimString(userId)
    const normalizedConnectionKey = trimString(connectionKey)
    const normalizedMessageId = trimString(messageId)
    const normalizedTaskId = trimString(taskId)
    const normalizedProjectId = trimString(projectId)
    if (trimString(provider).toLowerCase() === 'microsoft') return { state: 'skipped', reason: 'provider' }
    if (!normalizedUserId || !normalizedConnectionKey || !normalizedMessageId || !normalizedTaskId) {
        return { state: 'skipped', reason: 'missing_identity' }
    }

    const ref = getRegistryRef(database, normalizedUserId, normalizedTaskId)
    try {
        const existingSnapshot = await ref.get()
        let entry = existingSnapshot.exists ? existingSnapshot.data() || {} : null
        if (entry && entry.state !== STATE_PENDING) return { state: entry.state, reused: true }

        if (!entry) {
            // Another open task of this email already holds an Alldone star: this task shares it
            // and inherits whether the star was the user's before any task existed.
            const probe = { messageId: normalizedMessageId, connectionKey: normalizedConnectionKey }
            const sharedWith = adoptExistingStar
                ? null
                : (await findOtherActiveEntries(database, normalizedUserId, probe, normalizedTaskId))[0]
            let wasStarredBefore
            if (adoptExistingStar) {
                // The user's star in Gmail is what created this task: it belongs to the task.
                wasStarredBefore = false
            } else if (sharedWith) {
                wasStarredBefore = sharedWith.wasStarredBefore === true
            } else {
                try {
                    wasStarredBefore = await readMessageIsStarred(
                        withGmail,
                        normalizedUserId,
                        normalizedConnectionKey,
                        normalizedMessageId
                    )
                } catch (error) {
                    if (!isMessageNotFoundError(error)) throw error
                    await writeEntry(ref, {
                        taskId: normalizedTaskId,
                        projectId: normalizedProjectId,
                        connectionKey: normalizedConnectionKey,
                        gmailEmail: trimString(gmailEmail).toLowerCase(),
                        messageId: normalizedMessageId,
                        threadId: trimString(threadId),
                        wasStarredBefore: false,
                        state: STATE_MISSING,
                        createdAt: Date.now(),
                    })
                    return { state: STATE_MISSING }
                }
            }
            // Written BEFORE the star call: if the call succeeds and this process dies, the retry
            // still knows the star was not the user's and will remove it on Done.
            entry = {
                taskId: normalizedTaskId,
                projectId: normalizedProjectId,
                connectionKey: normalizedConnectionKey,
                gmailEmail: trimString(gmailEmail).toLowerCase(),
                messageId: normalizedMessageId,
                threadId: trimString(threadId),
                wasStarredBefore,
                state: STATE_PENDING,
                createdAt: Date.now(),
                ...(adoptExistingStar ? { origin: ORIGIN_GMAIL_STAR } : {}),
            }
            await writeEntry(ref, entry)
        }

        if (entry.wasStarredBefore === true) {
            await writeEntry(ref, { state: STATE_PREEXISTING })
            return { state: STATE_PREEXISTING }
        }

        await modifyStar(withGmail, normalizedUserId, entry.connectionKey, entry.messageId, true)
        await writeEntry(ref, { state: STATE_STARRED, starredAt: Date.now(), lastError: null })
        return { state: STATE_STARRED }
    } catch (error) {
        console.warn('[gmailTaskStar] Could not star the email of a created task', {
            userId: normalizedUserId,
            taskId: normalizedTaskId,
            messageId: normalizedMessageId,
            error: error?.message || String(error),
        })
        try {
            await writeEntry(ref, { lastError: String(error?.message || error).slice(0, 300) })
        } catch (_) {
            // The entry may not exist yet (the first read failed); nothing more to record.
        }
        return { state: 'error', error: error?.message || String(error) }
    }
}

/**
 * Finishes a star that an earlier creation left `pending` (Gmail failed after the task was
 * created). Used when the user asks for a task for an email that already has one: the existing task
 * is returned, no second task is created, and its star is completed. Does nothing for any other
 * state and for tasks without an entry (tasks created before AT-3165 are not starred afterwards).
 */
async function resumePendingTaskEmailStar(
    { userId, taskId },
    { database = admin.firestore(), withGmail = defaultWithGmail } = {}
) {
    const normalizedUserId = trimString(userId)
    const normalizedTaskId = trimString(taskId)
    if (!normalizedUserId || !normalizedTaskId) return { state: 'skipped' }
    const ref = getRegistryRef(database, normalizedUserId, normalizedTaskId)
    try {
        const snapshot = await ref.get()
        if (!snapshot.exists) return { state: 'skipped' }
        const entry = snapshot.data() || {}
        if (entry.state !== STATE_PENDING) return { state: entry.state }
        if (entry.wasStarredBefore === true) {
            await writeEntry(ref, { state: STATE_PREEXISTING })
            return { state: STATE_PREEXISTING }
        }
        const open = await isTaskOpen(database, entry.projectId, normalizedTaskId)
        if (open) {
            await modifyStar(withGmail, normalizedUserId, entry.connectionKey, entry.messageId, true)
            await writeEntry(ref, { state: STATE_STARRED, starredAt: Date.now(), lastError: null })
            return { state: STATE_STARRED }
        }
        // Done (or gone) meanwhile: make sure a star that may have landed is not left behind.
        if (!(await anotherOpenTaskHoldsStar(database, normalizedUserId, entry, normalizedTaskId))) {
            await modifyStar(withGmail, normalizedUserId, entry.connectionKey, entry.messageId, false)
        }
        await writeEntry(ref, { state: STATE_REMOVED, removedAt: Date.now(), lastError: null })
        return { state: STATE_REMOVED }
    } catch (error) {
        console.warn('[gmailTaskStar] Could not finish a pending email star', {
            userId: normalizedUserId,
            taskId: normalizedTaskId,
            error: error?.message || String(error),
        })
        return { state: 'error', error: error?.message || String(error) }
    }
}

async function isProjectMember(database, userId, projectId) {
    if (!projectId) return false
    const snapshot = await database.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists ? (snapshot.data() || {}).userIds : null
    return Array.isArray(userIds) && userIds.includes(userId)
}

// Loads the registry entry a task trigger may act on, or null. The entry must exist in the
// mailbox owner's own tree under this task id and name this project. A task copy in another
// project with the same id counts only once the move finished: the original is gone and the
// copy's project lists the mailbox owner.
async function loadEntryForTaskEvent(database, projectId, taskId, task) {
    if (!isGmailEmailTask(task)) return null
    const userId = trimString(task.gmailData.accountUserId)
    const ref = getRegistryRef(database, userId, taskId)
    const snapshot = await ref.get()
    if (!snapshot.exists) return null
    const entry = snapshot.data() || {}
    if (entry.state === STATE_DELETED || entry.state === STATE_MISSING) return null
    if (entry.projectId === projectId) return { userId, ref, entry }

    // Moved (moveTaskToDifferentProject keeps the id, writes the target, then deletes the source).
    const originalStillExists = (await database.doc(`items/${entry.projectId}/tasks/${taskId}`).get()).exists
    if (originalStillExists) return null
    if (!(await isProjectMember(database, userId, projectId))) return null
    await writeEntry(ref, { projectId })
    return { userId, ref, entry: { ...entry, projectId } }
}

async function removeStarForEntry({ database, withGmail, userId, ref, entry, taskId, finalState, reason }) {
    const wasActive = ACTIVE_STATES.has(entry.state)
    if (wasActive && entry.wasStarredBefore !== true) {
        const shared = await anotherOpenTaskHoldsStar(database, userId, entry, taskId)
        if (!shared) await modifyStar(withGmail, userId, entry.connectionKey, entry.messageId, false)
        await writeEntry(ref, {
            state: finalState,
            removedAt: Date.now(),
            removedReason: shared ? `${reason}_shared_star_kept` : reason,
            lastError: null,
        })
        return { state: finalState, gmailChanged: !shared }
    }
    if (finalState === STATE_DELETED) await writeEntry(ref, { state: STATE_DELETED, removedReason: reason })
    return { state: entry.state, gmailChanged: false }
}

// After Done: where the mailbox history stood, so the star import (gmailStarTaskImport.js) can tell a
// star set after Done (the user wants the task back) from an older star event it sees late. Read
// AFTER the removal, so Alldone's own star changes all lie at or below it. Best effort: without it
// the import falls back to the task's completion time.
async function recordDoneHistoryId({ withGmail, userId, ref, entry }) {
    try {
        const profile = await withTransientRetry(() =>
            withGmail(userId, entry.connectionKey, gmail => gmail.users.getProfile({ userId: 'me' }))
        )
        const historyId = profile?.data?.historyId ? String(profile.data.historyId) : ''
        await writeEntry(ref, { doneHistoryId: historyId || null, doneAt: Date.now() })
    } catch (error) {
        console.warn('[gmailTaskStar] Could not record the mailbox history position at Done', {
            userId,
            taskId: entry.taskId,
            error: error?.message || String(error),
        })
        try {
            await writeEntry(ref, { doneHistoryId: null, doneAt: Date.now() })
        } catch (_) {
            // Nothing more to record.
        }
    }
}

/**
 * Every registry entry (any state) Alldone recorded for one message of one connection. The star
 * import uses it to recognise Alldone's own stars and the tasks already linked to the message.
 */
// The same mailbox can be reached under two keys (a legacy project key and its `email_…` connection
// id), so an entry of the same Gmail address counts too; Gmail message ids are per mailbox.
async function findStarEntriesForMessage(
    { userId, connectionKey, gmailEmail = '', messageId },
    { database = admin.firestore() } = {}
) {
    const normalizedUserId = trimString(userId)
    const normalizedMessageId = trimString(messageId)
    if (!normalizedUserId || !normalizedMessageId) return []
    const snapshot = await database
        .collection('users')
        .doc(normalizedUserId)
        .collection(REGISTRY_COLLECTION)
        .where('messageId', '==', normalizedMessageId)
        .get()
    const entries = []
    snapshot.forEach(doc => {
        const data = doc.data() || {}
        const sameKey = !!trimString(connectionKey) && data.connectionKey === trimString(connectionKey)
        const email = trimString(gmailEmail).toLowerCase()
        const sameMailbox = !!email && trimString(data.gmailEmail).toLowerCase() === email
        if (!sameKey && !sameMailbox) return
        entries.push({ ...data, taskId: doc.id })
    })
    return entries
}

/**
 * The user's Gmail star reopened a done task (gmailStarTaskImport.js): that star now belongs to the
 * task, so its next Done removes it (decided with Karsten 2026-11-26). The message is already
 * starred, so Gmail is not called. An entry the task already has for ANOTHER message (a thread task
 * whose star sits on its first email) is left alone.
 */
async function adoptTaskEmailStar(
    { userId, connectionKey, gmailEmail = '', messageId, threadId = '', projectId, taskId },
    { database = admin.firestore() } = {}
) {
    const normalizedUserId = trimString(userId)
    const normalizedTaskId = trimString(taskId)
    const normalizedMessageId = trimString(messageId)
    if (!normalizedUserId || !normalizedTaskId || !normalizedMessageId || !trimString(connectionKey)) {
        return { adopted: false, reason: 'missing_identity' }
    }
    const ref = getRegistryRef(database, normalizedUserId, normalizedTaskId)
    const snapshot = await ref.get()
    const existing = snapshot.exists ? snapshot.data() || {} : null
    if (existing && existing.messageId && existing.messageId !== normalizedMessageId) {
        return { adopted: false, reason: 'other_message' }
    }
    await writeEntry(ref, {
        taskId: normalizedTaskId,
        projectId: trimString(projectId),
        connectionKey: trimString(connectionKey),
        gmailEmail: trimString(gmailEmail).toLowerCase() || existing?.gmailEmail || '',
        messageId: normalizedMessageId,
        threadId: trimString(threadId) || existing?.threadId || '',
        wasStarredBefore: false,
        state: STATE_STARRED,
        origin: ORIGIN_GMAIL_STAR,
        starredAt: Date.now(),
        doneHistoryId: null,
        removedReason: null,
        lastError: null,
        ...(existing ? {} : { createdAt: Date.now() }),
    })
    return { adopted: true }
}

/**
 * onUpdateTask: Done removes the star, reopening puts it back. Only `inDone` counts; moving through
 * workflow steps (which changes `userId`/`stepHistory` but not `inDone`) never touches Gmail. Never
 * throws: the task update itself already happened.
 */
async function syncTaskEmailStarOnTaskUpdate(
    { projectId, taskId, before = {}, after = {} },
    { database = admin.firestore(), withGmail = defaultWithGmail } = {}
) {
    const wasDone = before?.inDone === true
    const isDone = after?.inDone === true
    if (wasDone === isDone) return { action: 'none' }
    const task = isGmailEmailTask(after) ? after : before
    if (!isGmailEmailTask(task)) return { action: 'none' }

    try {
        const loaded = await loadEntryForTaskEvent(database, projectId, taskId, task)
        if (!loaded) return { action: 'none' }
        const { userId, ref, entry } = loaded

        if (isDone) {
            const result = await removeStarForEntry({
                database,
                withGmail,
                userId,
                ref,
                entry,
                taskId,
                finalState: STATE_REMOVED,
                reason: 'done',
            })
            await recordDoneHistoryId({ withGmail, userId, ref, entry })
            return { action: result.gmailChanged ? 'unstarred' : 'none', state: result.state }
        }

        // Reopened: star again what Alldone took away on Done (never a user's own star).
        if (entry.state !== STATE_REMOVED || entry.wasStarredBefore === true) {
            if (entry.doneHistoryId) await writeEntry(ref, { doneHistoryId: null })
            return { action: 'none' }
        }
        await modifyStar(withGmail, userId, entry.connectionKey, entry.messageId, true)
        await writeEntry(ref, {
            state: STATE_STARRED,
            starredAt: Date.now(),
            removedReason: null,
            lastError: null,
            doneHistoryId: null,
        })
        return { action: 'starred', state: STATE_STARRED }
    } catch (error) {
        console.warn('[gmailTaskStar] Could not sync the email star with the task state', {
            projectId,
            taskId,
            done: isDone,
            error: error?.message || String(error),
        })
        return { action: 'error', error: error?.message || String(error) }
    }
}

// The project (other than `deletedProjectId`) of the mailbox owner that now holds a task with this
// id, or ''. Triggers are not ordered, so the delete of a move's source can run before anything saw
// the copy; the owner's projects are checked directly. Membership is read from projects/{id}.userIds,
// never from the owner-written users/{uid}.projectIds alone.
async function findMovedCopyProjectId(database, userId, taskId, deletedProjectId) {
    const userSnapshot = await database.doc(`users/${userId}`).get()
    const userData = userSnapshot.exists ? userSnapshot.data() || {} : {}
    const projectIds = [...new Set(Array.isArray(userData.projectIds) ? userData.projectIds : [])].filter(
        id => typeof id === 'string' && id && id !== deletedProjectId
    )
    for (let index = 0; index < projectIds.length; index += 10) {
        const slice = projectIds.slice(index, index + 10)
        const copies = await Promise.all(slice.map(id => database.doc(`items/${id}/tasks/${taskId}`).get()))
        for (let position = 0; position < slice.length; position++) {
            if (!copies[position].exists) continue
            if (await isProjectMember(database, userId, slice[position])) return slice[position]
        }
    }
    return ''
}

/**
 * onDeleteTask: a deleted email task leaves no follow-up, so its star goes too. A delete that is
 * the second half of a project move (the copy with the same id exists in a project of the mailbox
 * owner) keeps the star, and the entry follows the task to its new project.
 */
async function syncTaskEmailStarOnTaskDelete(
    { projectId, taskId, task = {} },
    { database = admin.firestore(), withGmail = defaultWithGmail } = {}
) {
    if (!isGmailEmailTask(task)) return { action: 'none' }
    try {
        const userId = trimString(task.gmailData.accountUserId)
        const ref = getRegistryRef(database, userId, taskId)
        const snapshot = await ref.get()
        if (!snapshot.exists) return { action: 'none' }
        const entry = snapshot.data() || {}
        if (entry.projectId !== projectId) return { action: 'none' }
        if (entry.state === STATE_DELETED || entry.state === STATE_MISSING) return { action: 'none' }

        const movedTo = await findMovedCopyProjectId(database, userId, taskId, projectId)
        if (movedTo) {
            await writeEntry(ref, { projectId: movedTo })
            return { action: 'moved', projectId: movedTo }
        }

        const result = await removeStarForEntry({
            database,
            withGmail,
            userId,
            ref,
            entry,
            taskId,
            finalState: STATE_DELETED,
            reason: 'deleted',
        })
        return { action: result.gmailChanged ? 'unstarred' : 'none', state: STATE_DELETED }
    } catch (error) {
        console.warn('[gmailTaskStar] Could not remove the email star of a deleted task', {
            projectId,
            taskId,
            error: error?.message || String(error),
        })
        return { action: 'error', error: error?.message || String(error) }
    }
}

module.exports = {
    REGISTRY_COLLECTION,
    STAR_LABEL,
    STATE_PENDING,
    STATE_STARRED,
    STATE_PREEXISTING,
    STATE_REMOVED,
    STATE_DELETED,
    STATE_MISSING,
    ORIGIN_GMAIL_STAR,
    ACTIVE_STATES,
    adoptTaskEmailStar,
    findStarEntriesForMessage,
    isGmailEmailTask,
    starEmailOfCreatedTask,
    resumePendingTaskEmailStar,
    syncTaskEmailStarOnTaskUpdate,
    syncTaskEmailStarOnTaskDelete,
}
