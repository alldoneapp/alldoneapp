'use strict'

/**
 * Gmail → Alldone read sync, server side (AT-2376).
 *
 * The client half of this (`utils/backends/EmailLine/emailCommentReadSync.js`) only runs while
 * someone is looking at the chat list, so an email read or archived in Gmail stayed unread in
 * Alldone until the next visit. This half runs inside the scheduled labeling sync
 * (`pollGmailLabelingSecondGen` → `syncGmailLabeling`), which already holds an authorized Gmail
 * client for exactly the account that produced those comments — so no new schedule, no new auth
 * path, no second client build.
 *
 * The mapping it needs — Gmail messageId → Alldone chat comment — is written by the sync itself:
 * the post-label prompt's `add_chat_comment` result is stamped onto the message's audit record
 * (`emailComments` + `emailCommentReadPending`). That is what makes this a plain
 * `where('emailCommentReadPending','==',true)` query on an existing per-user subcollection: no
 * collection-group index, no new collection, no migration. Comments created BEFORE this shipped
 * carry no stamp and stay with the client-side fallback, which is unchanged.
 *
 * Cost discipline, in order:
 *   1. one indexed query per sync run, capped at MAX_CANDIDATES_PER_RUN;
 *   2. the notification docs are read first — a comment the user already read costs ZERO Gmail
 *      calls and is retired on the spot;
 *   3. only what is still unread is looked up in Gmail, `format: 'minimal'` (labels only),
 *      bounded concurrency, capped per run.
 */

const admin = require('firebase-admin')
const { Timestamp } = require('firebase-admin/firestore')
const { getGmailLabelingStateRef } = require('./gmailLabelingConfig')

// Audit records considered per run. Everything the cap leaves behind keeps its pending flag and is
// picked up by the next run, so the backlog drains instead of being dropped.
const MAX_CANDIDATES_PER_RUN = 50
// Gmail lookups per run. Only still-unread comments reach this.
const MAX_MESSAGE_LOOKUPS_PER_RUN = 50
const MESSAGE_LOOKUP_CONCURRENCY = 10
// Firestore hard limits are 500 writes per batch and 1000 reads per getAll; stay well under.
const READ_CHUNK = 200
const WRITE_CHUNK = 300
// A comment nobody ever read would otherwise be re-checked forever. After this it is retired from
// the pending pool WITHOUT being marked read — the unread state is the user's, not ours to expire.
const MAX_PENDING_AGE_MS = 30 * 24 * 60 * 60 * 1000

const GMAIL_DIRECTION_OUTGOING = 'outgoing'

function getMessagesAuditCollectionRef(userId, connectionKey) {
    return getGmailLabelingStateRef(userId, connectionKey).collection('messages')
}

function chunk(items, size) {
    const chunks = []
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
    return chunks
}

/**
 * The comment references stamped on an audit record, normalized and deduplicated. Anything without
 * both a project and a comment id is unusable (there is no notification doc to address) and is
 * dropped rather than guessed at.
 */
function normalizeCommentRefs(value) {
    const refs = []
    const seen = new Set()
    ;(Array.isArray(value) ? value : []).forEach(ref => {
        const projectId = String(ref?.projectId || '').trim()
        const commentId = String(ref?.commentId || '').trim()
        if (!projectId || !commentId) return
        const key = `${projectId}:${commentId}`
        if (seen.has(key)) return
        seen.add(key)
        refs.push({ projectId, commentId, chatId: String(ref?.chatId || '').trim() })
    })
    return refs
}

/**
 * The product rule. Twin of `isEmailHandledInMailbox` in the client module — Cloud Functions cannot
 * import app code, so it is restated here; keep the two in step.
 *
 * An email counts as handled when it is no longer unread, when it has left the inbox, or when it is
 * gone from the mailbox. **Archived counts even while Gmail still flags the message UNREAD**:
 * leaving the inbox is the user saying they are done with it.
 *
 * Two cases where leaving the inbox says nothing about the USER, and where this server-side rule is
 * therefore stricter than the client's (it has the audit record, the client does not):
 *   - the labeling sync archived the message itself (`autoArchive`), so it was already out of the
 *     inbox when the comment was created — treating that as "handled" would mark every
 *     auto-archived comment read the moment it appears;
 *   - an outgoing (SENT) message is never in the inbox at all.
 * For both, only "read" or "deleted" is evidence.
 *
 * A state that could not be read is never handled: the caller omits those entirely, and anything
 * unexpected here answers false, so a comment is only ever cleared on positive evidence.
 */
function isEmailHandledInMailbox(state, { archivedByLabeling = false, direction = '' } = {}) {
    if (!state || !state.messageId) return false
    if (state.exists === false) return true
    if (state.unread === false) return true
    if (state.inInbox === false) {
        if (archivedByLabeling) return false
        if (String(direction || '').toLowerCase() === GMAIL_DIRECTION_OUTGOING) return false
        return true
    }
    return false
}

function isMessageNotFoundError(error) {
    if (error?.code === 404 || error?.response?.status === 404) return true
    const message = String(error?.message || '')
    return message.includes('Requested entity was not found') || message.includes('Not Found')
}

/**
 * Current mailbox state of the given messages, read through the sync's own Gmail client.
 * `format: 'minimal'` returns labelIds without the payload — the cheapest way to read both flags.
 * A 404 is a definite state (the user deleted the mail); anything else is omitted, never defaulted.
 */
async function readMessageStates(gmail, messageIds) {
    const states = new Map()

    for (const ids of chunk(messageIds, MESSAGE_LOOKUP_CONCURRENCY)) {
        const results = await Promise.all(
            ids.map(async messageId => {
                try {
                    const detail = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' })
                    const labelIds = Array.isArray(detail?.data?.labelIds) ? detail.data.labelIds : []
                    return {
                        messageId,
                        exists: true,
                        unread: labelIds.includes('UNREAD'),
                        inInbox: labelIds.includes('INBOX'),
                    }
                } catch (error) {
                    if (isMessageNotFoundError(error)) {
                        return { messageId, exists: false, unread: false, inInbox: false }
                    }
                    console.warn('[gmailLabeling] Could not read Gmail message state for read sync', {
                        messageId,
                        error: error?.message,
                    })
                    return null
                }
            })
        )
        results.filter(Boolean).forEach(state => states.set(state.messageId, state))
    }

    return states
}

function buildResolutionPatch(resolution) {
    return {
        emailCommentReadPending: false,
        emailCommentReadResolution: resolution,
        emailCommentReadSyncedAt: Timestamp.now(),
    }
}

function toMillis(value) {
    if (!value) return 0
    if (typeof value.toMillis === 'function') return value.toMillis()
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Marks the Alldone chat comments of emails the user has meanwhile handled in Gmail as read.
 * Returns counters for the sync log. Never throws for a single bad candidate — the caller runs it
 * as a best-effort step of a sync whose primary job is labeling.
 */
async function reconcileEmailCommentReadState({ gmail, userId, connectionKey, now = Date.now() }) {
    const summary = { candidates: 0, alreadyRead: 0, looked: 0, markedRead: 0, expired: 0, stillUnread: 0 }
    if (!gmail || !userId || !connectionKey) return summary

    const snapshot = await getMessagesAuditCollectionRef(userId, connectionKey)
        .where('emailCommentReadPending', '==', true)
        .limit(MAX_CANDIDATES_PER_RUN)
        .get()

    if (snapshot.empty) return summary

    const db = admin.firestore()
    const candidates = snapshot.docs.map(doc => {
        const data = doc.data() || {}
        return {
            ref: doc.ref,
            messageId: data.gmailMessageId || doc.id,
            commentRefs: normalizeCommentRefs(data.emailComments),
            archivedByLabeling: data.archived === true,
            direction: data.direction || '',
            processedAtMillis: toMillis(data.processedAt),
        }
    })
    summary.candidates = candidates.length

    const resolutions = []
    const usable = []
    candidates.forEach(candidate => {
        if (candidate.commentRefs.length === 0) {
            // Nothing addressable to mark as read — retire it instead of re-querying forever.
            resolutions.push({ ref: candidate.ref, patch: buildResolutionPatch('no_comment') })
            return
        }
        if (candidate.processedAtMillis && now - candidate.processedAtMillis > MAX_PENDING_AGE_MS) {
            resolutions.push({ ref: candidate.ref, patch: buildResolutionPatch('expired') })
            summary.expired += 1
            return
        }
        usable.push(candidate)
    })

    // Which comments are still unread. Unread state IS the existence of the notification doc, so
    // this both filters the Gmail lookups down and tells us exactly which docs to delete.
    const notificationRefs = []
    usable.forEach(candidate => {
        candidate.commentRefs.forEach(commentRef => {
            notificationRefs.push({
                candidate,
                commentRef,
                docRef: db.doc(`chatNotifications/${commentRef.projectId}/${userId}/${commentRef.commentId}`),
            })
        })
    })

    const unreadByMessageId = new Map()
    for (const group of chunk(notificationRefs, READ_CHUNK)) {
        const snapshots = await db.getAll(...group.map(entry => entry.docRef))
        snapshots.forEach((notificationSnapshot, index) => {
            if (!notificationSnapshot.exists) return
            const entry = group[index]
            const existing = unreadByMessageId.get(entry.candidate.messageId) || []
            existing.push(entry.docRef)
            unreadByMessageId.set(entry.candidate.messageId, existing)
        })
    }

    const stillUnread = usable.filter(candidate => unreadByMessageId.has(candidate.messageId))
    usable
        .filter(candidate => !unreadByMessageId.has(candidate.messageId))
        .forEach(candidate => {
            summary.alreadyRead += 1
            resolutions.push({ ref: candidate.ref, patch: buildResolutionPatch('already_read') })
        })

    const lookups = stillUnread.slice(0, MAX_MESSAGE_LOOKUPS_PER_RUN)
    summary.looked = lookups.length
    const states =
        lookups.length > 0
            ? await readMessageStates(
                  gmail,
                  lookups.map(c => c.messageId)
              )
            : new Map()

    const notificationsToDelete = []
    lookups.forEach(candidate => {
        const state = states.get(candidate.messageId)
        if (!state) return // unknown — stays pending, retried next run
        if (
            !isEmailHandledInMailbox(state, {
                archivedByLabeling: candidate.archivedByLabeling,
                direction: candidate.direction,
            })
        ) {
            summary.stillUnread += 1
            return
        }
        notificationsToDelete.push(...(unreadByMessageId.get(candidate.messageId) || []))
        summary.markedRead += 1
        resolutions.push({ ref: candidate.ref, patch: buildResolutionPatch('mailbox_handled') })
    })

    // Deleting the notification doc IS marking the comment read. Idempotent: a doc the user cleared
    // in the meantime simply deletes again as a no-op.
    for (const group of chunk(notificationsToDelete, WRITE_CHUNK)) {
        const batch = db.batch()
        group.forEach(docRef => batch.delete(docRef))
        await batch.commit()
    }

    for (const group of chunk(resolutions, WRITE_CHUNK)) {
        const batch = db.batch()
        group.forEach(entry => batch.set(entry.ref, entry.patch, { merge: true }))
        await batch.commit()
    }

    return summary
}

/**
 * The stamp the reconciler runs on: the chat comments a post-label prompt created for this message.
 * Written as part of the normal audit record, so it costs no extra Firestore write.
 */
function buildEmailCommentAuditPatch(createdChatCommentResults = []) {
    const emailComments = normalizeCommentRefs(createdChatCommentResults)
    if (emailComments.length === 0) return {}
    return { emailComments, emailCommentReadPending: true }
}

module.exports = {
    MAX_CANDIDATES_PER_RUN,
    MAX_MESSAGE_LOOKUPS_PER_RUN,
    MAX_PENDING_AGE_MS,
    buildEmailCommentAuditPatch,
    isEmailHandledInMailbox,
    normalizeCommentRefs,
    reconcileEmailCommentReadState,
}
