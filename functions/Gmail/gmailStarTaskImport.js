'use strict'

// AT-3165 follow-up: a star the user sets on an email in Gmail creates an Alldone email task for
// exactly that message, in the mailbox it was set in (decided with Karsten 2026-11-26).
//
// Where the star is seen: there is no Gmail push (users.watch / Pub/Sub) in this codebase. The only
// thing that watches mailboxes is the five-minute poller of the Gmail labeling automation
// (pollGmailLabelingSecondGen → processEnabledGmailLabelingConfigs), and its history cursor asks for
// `messageAdded` only. This import therefore runs on that same tick, for connections with labeling
// enabled (premium), with its OWN cursor over `labelAdded` history records. A task appears at most one
// tick (about five minutes) after the star. Each connection can switch it off in the labeling
// settings (`createTaskOnStar`, default on).
//
// Product rules:
// - No backfill. The first run (and every resync) only stores the mailbox's current historyId: stars
//   that already exist, or were set while the import did not run (switched off, labeling off, a gap
//   longer than MAX_CURSOR_GAP_MS, an expired history id), are never imported.
// - The existing server-side creation path creates the task (emailLineService.createTaskFromEmail,
//   the "Create task" button's path): same title, project routing, Gold, thread continuation and
//   duplicate guards. The star that asked for the task belongs to it (`adoptExistingStar`): Done
//   removes it, reopening puts it back.
// - A message that already has a task creates nothing. If that task is open: nothing happens. If it
//   is Done and the star came after Done: the task is reopened to Open, and the star belongs to it.
// - Alldone's own stars (on creation, on reopen) never create or reopen anything: Alldone writes its
//   registry entry (gmailTaskStar.js) BEFORE it stars, so its star event always finds a linked task,
//   and Alldone only ever stars while that task is open.
//
// Duplicate and race guards, from outside in:
// 1. a lease on the connection's cursor document: one import per connection at a time (the scheduler
//    may overlap ticks);
// 2. one claim document per star event (message + history record id): a crash before the cursor moved
//    replays events, the claim makes them no-ops;
// 3. every decision is made on the current state (is the message still starred, is a task linked, is
//    it open), so a replayed or late event that slipped past 1 and 2 still changes nothing;
// 4. createTaskFromEmail's own guards (linked-task lookup and the thread-task store) for a concurrent
//    "Create task" click or labeling run on the same email.
//
// Late events: a star event is only acted on if the message is starred NOW. Reopening needs proof the
// star came after Done: its history record id is above the `doneHistoryId` the Done trigger stored, or
// (tasks without that record) the task was completed well before the start of the history window
// being read.

const admin = require('firebase-admin')

const STAR_LABEL = 'STARRED'
const IMPORT_COLLECTION = 'gmailStarImports' // server-owned (firestore.rules)
const MAX_CURSOR_GAP_MS = 60 * 60 * 1000 // a longer gap restarts the cursor without importing
const LEASE_MS = 10 * 60 * 1000
const MAX_HISTORY_PAGES = 5
const MAX_MESSAGES_PER_RUN = 10
const MAX_EVENT_ATTEMPTS = 3
const DONE_BEFORE_WINDOW_MARGIN_MS = 10 * 60 * 1000 // clock skew between client `completed` and Gmail
const SKIP_LABELS = ['TRASH', 'SPAM', 'DRAFT']

const TERMINAL_EVENT_STATES = new Set([
    'created',
    'linked_existing',
    'linked_open',
    'reopened',
    'linked_done_before_star',
    'not_starred',
    'message_missing',
    'skipped_label',
    'insufficient_gold',
    'no_project_access',
    'failed',
])

function trimString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function toHistoryNumber(value) {
    if (value === null || value === undefined || value === '') return null
    try {
        return BigInt(String(value))
    } catch (_) {
        return null
    }
}

function safeKey(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_')
}

function isStarImportEnabled(config = {}) {
    return config?.createTaskOnStar !== false
}

function getImportCollection(database, userId) {
    return database.collection('users').doc(userId).collection(IMPORT_COLLECTION)
}

function getCursorRef(database, userId, connectionKey) {
    return getImportCollection(database, userId).doc(`cursor_${safeKey(connectionKey)}`)
}

function getEventRef(database, userId, connectionKey, messageId, recordId) {
    return getImportCollection(database, userId).doc(
        `event_${safeKey(connectionKey)}_${safeKey(messageId)}_${safeKey(recordId)}`
    )
}

function isNotFoundError(error) {
    if (error?.code === 404 || error?.response?.status === 404) return true
    const message = String(error?.message || '')
    return message.includes('Requested entity was not found') || message.includes('Not Found')
}

function isStaleHistoryError(error) {
    return (
        isNotFoundError(error) ||
        String(error?.message || '')
            .toLowerCase()
            .includes('historyid')
    )
}

function defaultWithGmail(userId, connectionKey, run) {
    return require('../Email/emailLine/gmailEmailLine').withGmailClient(userId, connectionKey, run)
}

const defaultDeps = () => ({
    database: admin.firestore(),
    withGmail: defaultWithGmail,
    now: () => Date.now(),
    resolveConnection: (userId, connectionKey, userData) =>
        require('../Email/emailLine/emailLineService').resolveConnectionOrThrow(userId, connectionKey, userData),
    findLinkedTask: async ({ userId, connectionKey, connection, userData, messageId }) => {
        const { getTaskForEmail } = require('../Email/emailLine/emailLineService')
        const { taskCreated } = await getTaskForEmail({
            userId,
            projectId: connectionKey,
            connection,
            userData,
            messageIds: [messageId],
        })
        return taskCreated || null
    },
    createTask: args => require('../Email/emailLine/emailLineService').createTaskFromEmail(args),
    reopenTask: ({ database, projectId, taskId, actorUserId, editorName }) =>
        require('../Tasks/doneTaskReactivation').reactivateDoneTaskForAssistantWork({
            db: database,
            projectId,
            taskId,
            actorUserId,
            editorName,
            toOpen: true,
            reason: 'gmail_star',
        }),
})

async function readProfileHistoryId(withGmail, userId, connectionKey) {
    const profile = await withGmail(userId, connectionKey, gmail => gmail.users.getProfile({ userId: 'me' }))
    return profile?.data?.historyId ? String(profile.data.historyId) : ''
}

// Lease on the cursor document: one import per connection at a time. Returns the cursor data, or
// null when another run holds the lease.
async function acquireLease(database, ref, now, leaseId) {
    return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const data = snapshot.exists ? snapshot.data() || {} : {}
        if (Number(data.leaseUntil) > now && data.leaseId && data.leaseId !== leaseId) return null
        transaction.set(ref, { leaseId, leaseUntil: now + LEASE_MS }, { merge: true })
        return data
    })
}

async function releaseLease(ref, leaseId, patch = {}) {
    await ref.set({ ...patch, leaseId: null, leaseUntil: 0, leaseReleasedBy: leaseId }, { merge: true })
}

// The STARRED additions in the history after `startHistoryId`, one group per message (its lowest and
// highest record id). Only `labelAdded` records are read; removals never create anything.
async function listStarEvents(withGmail, userId, connectionKey, startHistoryId) {
    const groups = new Map()
    let pageToken
    let pages = 0
    let latestHistoryId = ''
    let maxRecordId = null
    let truncated = false
    do {
        const response = await withGmail(userId, connectionKey, gmail =>
            gmail.users.history.list({
                userId: 'me',
                startHistoryId,
                historyTypes: ['labelAdded'],
                pageToken,
            })
        )
        const data = response?.data || {}
        if (data.historyId) latestHistoryId = String(data.historyId)
        for (const record of Array.isArray(data.history) ? data.history : []) {
            const recordId = toHistoryNumber(record?.id)
            if (recordId === null) continue
            if (maxRecordId === null || recordId > maxRecordId) maxRecordId = recordId
            for (const added of Array.isArray(record.labelsAdded) ? record.labelsAdded : []) {
                const messageId = trimString(added?.message?.id)
                const labelIds = Array.isArray(added?.labelIds) ? added.labelIds : []
                if (!messageId || !labelIds.includes(STAR_LABEL)) continue
                const group = groups.get(messageId) || {
                    messageId,
                    threadId: trimString(added?.message?.threadId),
                    minRecordId: recordId,
                    maxRecordId: recordId,
                }
                if (recordId < group.minRecordId) group.minRecordId = recordId
                if (recordId > group.maxRecordId) group.maxRecordId = recordId
                groups.set(messageId, group)
            }
        }
        pageToken = data.nextPageToken
        pages += 1
        if (pageToken && pages >= MAX_HISTORY_PAGES) truncated = true
    } while (pageToken && !truncated)

    return {
        events: [...groups.values()].sort((a, b) =>
            a.maxRecordId < b.maxRecordId ? -1 : a.maxRecordId > b.maxRecordId ? 1 : 0
        ),
        latestHistoryId,
        maxRecordId,
        truncated,
    }
}

async function claimEvent(database, ref, now) {
    return database.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const data = snapshot.exists ? snapshot.data() || {} : {}
        if (TERMINAL_EVENT_STATES.has(data.state)) return { claimed: false, state: data.state }
        const attempts = Number(data.attempts) || 0
        if (attempts >= MAX_EVENT_ATTEMPTS) {
            transaction.set(ref, { state: 'failed', updatedAt: now }, { merge: true })
            return { claimed: false, state: 'failed' }
        }
        transaction.set(ref, { state: 'processing', attempts: attempts + 1, updatedAt: now }, { merge: true })
        return { claimed: true, attempts: attempts + 1 }
    })
}

async function isTaskOpenDoc(database, projectId, taskId) {
    if (!projectId || !taskId) return { exists: false }
    const snapshot = await database.doc(`items/${projectId}/tasks/${taskId}`).get()
    if (!snapshot.exists) return { exists: false }
    const task = snapshot.data() || {}
    return { exists: true, open: task.inDone !== true, task }
}

async function isProjectMember(database, userId, projectId) {
    if (!projectId) return false
    const snapshot = await database.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists ? (snapshot.data() || {}).userIds : null
    return Array.isArray(userIds) && userIds.includes(userId)
}

// Proof that a star event came after the task reached Done, so the user wants the task back. Never
// true for a star older than Done (Alldone's own star while the task was open, or the star that led
// to the task, seen late).
function starCameAfterDone({ event, entry, task, windowStartedAt }) {
    const doneHistoryId = toHistoryNumber(entry?.doneHistoryId)
    if (doneHistoryId !== null) return event.maxRecordId > doneHistoryId
    // No history position recorded at Done (older task, or the read failed): every event in this
    // window happened after `windowStartedAt`, so a task completed well before it was Done first.
    const completed = Number(task?.completed)
    if (!Number.isFinite(completed) || completed <= 0 || !Number.isFinite(windowStartedAt)) return false
    return completed < windowStartedAt - DONE_BEFORE_WINDOW_MARGIN_MS
}

async function reopenLinkedDoneTask({ deps, userId, userData, connectionKey, gmailEmail, event, link }) {
    const { database } = deps
    if (!(await isProjectMember(database, userId, link.projectId))) {
        return { state: 'linked_done_before_star', reason: 'not_member' }
    }
    const result = await deps.reopenTask({
        database,
        projectId: link.projectId,
        taskId: link.taskId,
        actorUserId: userId,
        editorName: userData?.displayName || userData?.name || '',
    })
    if (!result?.reactivated && result?.reason !== 'not_done') {
        return { state: 'linked_done_before_star', reason: result?.reason || 'not_reopened' }
    }
    const { adoptTaskEmailStar } = require('./gmailTaskStar')
    await adoptTaskEmailStar(
        {
            userId,
            connectionKey,
            gmailEmail,
            messageId: event.messageId,
            threadId: event.threadId,
            projectId: link.projectId,
            taskId: link.taskId,
        },
        { database }
    )
    return {
        state: result?.reactivated ? 'reopened' : 'linked_open',
        taskId: link.taskId,
        projectId: link.projectId,
    }
}

// Decides one star event on the current state. Returns { state, retry? }.
async function processStarEvent({
    deps,
    userId,
    userData,
    connection,
    connectionKey,
    gmailEmail,
    event,
    windowStartedAt,
}) {
    const { database, withGmail } = deps

    // 1. Is the message starred NOW? A late event for a star that is gone again creates nothing.
    let labelIds
    try {
        const response = await withGmail(userId, connectionKey, gmail =>
            gmail.users.messages.get({ userId: 'me', id: event.messageId, format: 'minimal' })
        )
        labelIds = Array.isArray(response?.data?.labelIds) ? response.data.labelIds : []
        if (!event.threadId && response?.data?.threadId) event.threadId = String(response.data.threadId)
    } catch (error) {
        if (isNotFoundError(error)) return { state: 'message_missing' }
        throw error
    }
    if (!labelIds.includes(STAR_LABEL)) return { state: 'not_starred' }
    if (SKIP_LABELS.some(label => labelIds.includes(label))) return { state: 'skipped_label' }

    // 2. Tasks Alldone itself linked to this message (its own stars always land here first).
    const { findStarEntriesForMessage, STATE_DELETED, STATE_MISSING } = require('./gmailTaskStar')
    const entries = await findStarEntriesForMessage(
        { userId, connectionKey, gmailEmail, messageId: event.messageId },
        { database }
    )
    const doneCandidates = []
    let recentlyDeleted = false
    for (const entry of entries) {
        if (entry.state === STATE_MISSING) continue
        if (entry.state === STATE_DELETED) {
            const deletedAt = Number(entry.updatedAt) || 0
            if (!(deletedAt && deletedAt < windowStartedAt - DONE_BEFORE_WINDOW_MARGIN_MS)) recentlyDeleted = true
            continue
        }
        const taskState = await isTaskOpenDoc(database, entry.projectId, entry.taskId)
        if (!taskState.exists) continue
        if (taskState.open) return { state: 'linked_open', taskId: entry.taskId, projectId: entry.projectId }
        doneCandidates.push({ entry, task: taskState.task })
    }
    if (doneCandidates.length > 0) {
        // The most recently completed one is the task the user means.
        doneCandidates.sort((a, b) => (Number(b.task.completed) || 0) - (Number(a.task.completed) || 0))
        const { entry, task } = doneCandidates[0]
        if (!starCameAfterDone({ event, entry, task, windowStartedAt })) return { state: 'linked_done_before_star' }
        return reopenLinkedDoneTask({
            deps,
            userId,
            userData,
            connectionKey,
            gmailEmail,
            event,
            link: { taskId: entry.taskId, projectId: entry.projectId },
        })
    }
    // A task of this email was deleted within this window: the star may well be from before that.
    if (recentlyDeleted) return { state: 'linked_done_before_star', reason: 'deleted_recently' }

    // 3. Tasks linked to the message without a registry entry (created before AT-3165, or by a path
    // that does not star). Same lookup the "Create task" button uses.
    const linked = await deps.findLinkedTask({
        userId,
        connectionKey,
        connection,
        userData,
        messageId: event.messageId,
    })
    if (linked?.taskId && linked?.projectId) {
        const taskState = await isTaskOpenDoc(database, linked.projectId, linked.taskId)
        if (!taskState.exists || taskState.open) {
            return { state: 'linked_open', taskId: linked.taskId, projectId: linked.projectId }
        }
        // Without a server record of the link, only a task the mailbox owner owns is reopened (a
        // member-written gmailData must not let a star reopen someone else's task).
        if (taskState.task.userId !== userId) return { state: 'linked_done_before_star', reason: 'not_owner' }
        if (!starCameAfterDone({ event, entry: null, task: taskState.task, windowStartedAt })) {
            return { state: 'linked_done_before_star' }
        }
        return reopenLinkedDoneTask({ deps, userId, userData, connectionKey, gmailEmail, event, link: linked })
    }

    // 4. No task yet: the existing creation path creates it; the user's star belongs to it.
    try {
        const created = await deps.createTask({
            userId,
            projectId: connectionKey,
            connection,
            userData,
            messageId: event.messageId,
            adoptExistingStar: true,
        })
        return {
            state: created?.existing ? 'linked_existing' : 'created',
            taskId: created?.taskId || null,
            projectId: created?.projectId || null,
        }
    } catch (error) {
        if (error?.code === 'INSUFFICIENT_GOLD' || error?.message === 'INSUFFICIENT_GOLD') {
            return { state: 'insufficient_gold' }
        }
        if (error?.code === 'NO_PROJECT_ACCESS') return { state: 'no_project_access' }
        throw error
    }
}

function isAuthLikeError(error) {
    if (error?.name === 'EmailLineAuthError') return true
    const status = Number(error?.code || error?.response?.status)
    if (status === 401) return true
    return String(error?.message || '').includes('invalid_grant')
}

/**
 * Runs the star import for one Gmail labeling connection. Best effort and never throws: it rides on
 * the labeling poller, whose own job must not fail because of it.
 *
 * @param {object} params `{ userId, connectionKey, config, userData? }` (config: the stored labeling
 *   config of the connection; `createTaskOnStar: false` switches the import off)
 */
async function importStarredGmailMessages(
    { userId, connectionKey, config = {}, userData: providedUserData },
    overrides = {}
) {
    const deps = { ...defaultDeps(), ...overrides }
    const { database } = deps
    const normalizedUserId = trimString(userId)
    const normalizedKey = trimString(connectionKey)
    if (!normalizedUserId || !normalizedKey) return { state: 'skipped', reason: 'missing_identity' }
    const cursorRef = getCursorRef(database, normalizedUserId, normalizedKey)

    try {
        if (!isStarImportEnabled(config)) {
            // Switched off: forget the cursor, so switching it on again starts fresh (no backfill).
            const snapshot = await cursorRef.get()
            if (snapshot.exists && (snapshot.data() || {}).historyId) {
                await cursorRef.set({ historyId: null, disabledAt: deps.now() }, { merge: true })
            }
            return { state: 'disabled' }
        }

        const userData =
            providedUserData ||
            (await database
                .doc(`users/${normalizedUserId}`)
                .get()
                .then(snapshot => (snapshot.exists ? snapshot.data() || {} : null)))
        if (!userData) return { state: 'skipped', reason: 'user_not_found' }
        if (userData?.premium?.status !== 'premium') return { state: 'skipped', reason: 'premium_required' }

        const startedAt = deps.now()
        const leaseId = `${normalizedKey}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`
        const cursor = await acquireLease(database, cursorRef, startedAt, leaseId)
        if (!cursor) return { state: 'locked' }

        let releasePatch = {}
        try {
            const initialize = async reason => {
                const historyId = await readProfileHistoryId(deps.withGmail, normalizedUserId, normalizedKey)
                const at = deps.now()
                releasePatch = {
                    historyId: historyId || null,
                    capturedAt: at,
                    checkedAt: at,
                    initializedAt: at,
                    initReason: reason,
                    disabledAt: null,
                }
                console.log('[gmailStarImport] Star import cursor (re)started; existing stars are not imported', {
                    userId: normalizedUserId,
                    connectionKey: normalizedKey,
                    reason,
                })
                return { state: 'initialized', reason }
            }

            if (!cursor.historyId) return await initialize(cursor.disabledAt ? 're_enabled' : 'first_run')
            const checkedAt = Number(cursor.checkedAt) || 0
            if (!checkedAt || startedAt - checkedAt > MAX_CURSOR_GAP_MS) return await initialize('gap')

            const { connection } = await deps.resolveConnection(normalizedUserId, normalizedKey, userData)
            if (connection?.provider === 'microsoft') return { state: 'skipped', reason: 'provider' }
            const gmailEmail = connection?.emailAddress || ''

            let listed
            try {
                listed = await listStarEvents(deps.withGmail, normalizedUserId, normalizedKey, cursor.historyId)
            } catch (error) {
                if (isStaleHistoryError(error)) return await initialize('history_expired')
                throw error
            }

            const windowStartedAt = Number(cursor.capturedAt) || checkedAt
            const summary = { state: 'ok', events: listed.events.length, results: [] }
            let stopAt = null
            let processed = 0
            for (const event of listed.events) {
                if (processed >= MAX_MESSAGES_PER_RUN) {
                    stopAt = event
                    break
                }
                const eventRef = getEventRef(
                    database,
                    normalizedUserId,
                    normalizedKey,
                    event.messageId,
                    event.maxRecordId.toString()
                )
                const claim = await claimEvent(database, eventRef, deps.now())
                if (!claim.claimed) {
                    summary.results.push({ messageId: event.messageId, state: 'duplicate', previous: claim.state })
                    continue
                }
                processed += 1
                let outcome
                try {
                    outcome = await processStarEvent({
                        deps,
                        userId: normalizedUserId,
                        userData,
                        connection,
                        connectionKey: normalizedKey,
                        gmailEmail,
                        event,
                        windowStartedAt,
                    })
                } catch (error) {
                    await eventRef.set(
                        {
                            state: claim.attempts >= MAX_EVENT_ATTEMPTS ? 'failed' : 'retry',
                            lastError: String(error?.message || error).slice(0, 300),
                            updatedAt: deps.now(),
                        },
                        { merge: true }
                    )
                    console.warn('[gmailStarImport] Could not handle a Gmail star', {
                        userId: normalizedUserId,
                        connectionKey: normalizedKey,
                        messageId: event.messageId,
                        attempt: claim.attempts,
                        error: error?.message || String(error),
                    })
                    if (isAuthLikeError(error)) throw error
                    if (claim.attempts < MAX_EVENT_ATTEMPTS) {
                        // Keep the cursor before this event; the next tick tries again.
                        stopAt = event
                        break
                    }
                    summary.results.push({ messageId: event.messageId, state: 'failed' })
                    continue
                }
                await eventRef.set(
                    {
                        connectionKey: normalizedKey,
                        messageId: event.messageId,
                        recordId: event.maxRecordId.toString(),
                        ...outcome,
                        lastError: null,
                        updatedAt: deps.now(),
                    },
                    { merge: true }
                )
                summary.results.push({ messageId: event.messageId, ...outcome })
                if (outcome.state === 'created' || outcome.state === 'reopened') {
                    console.log('[gmailStarImport] Gmail star handled', {
                        userId: normalizedUserId,
                        connectionKey: normalizedKey,
                        messageId: event.messageId,
                        state: outcome.state,
                        taskId: outcome.taskId || null,
                    })
                }
            }

            // Advance the cursor. Monotonic: never behind where it was.
            const previous = toHistoryNumber(cursor.historyId)
            let next
            let capturedAt
            if (stopAt) {
                next = stopAt.minRecordId - 1n
                capturedAt = windowStartedAt // events past `next` are still older than this run
            } else if (listed.truncated) {
                next = listed.maxRecordId
                capturedAt = windowStartedAt
            } else {
                next = toHistoryNumber(listed.latestHistoryId) ?? listed.maxRecordId
                capturedAt = startedAt
            }
            if (next === null || next === undefined || (previous !== null && next < previous)) {
                next = previous
                capturedAt = windowStartedAt
            }
            releasePatch = {
                historyId: next === null ? cursor.historyId : next.toString(),
                capturedAt,
                checkedAt: deps.now(),
                lastRunAt: startedAt,
            }
            return summary
        } finally {
            await releaseLease(cursorRef, leaseId, releasePatch)
        }
    } catch (error) {
        console.warn('[gmailStarImport] Star import failed for a connection', {
            userId: normalizedUserId,
            connectionKey: normalizedKey,
            error: error?.message || String(error),
        })
        return { state: 'error', error: error?.message || String(error) }
    }
}

module.exports = {
    IMPORT_COLLECTION,
    MAX_CURSOR_GAP_MS,
    MAX_MESSAGES_PER_RUN,
    MAX_EVENT_ATTEMPTS,
    DONE_BEFORE_WINDOW_MARGIN_MS,
    importStarredGmailMessages,
    isStarImportEnabled,
    listStarEvents,
    starCameAfterDone,
}
