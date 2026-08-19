/**
 * Gmail → Alldone read sync for email chat comments (AT-2376).
 *
 * An email that the Gmail labeling sync files as "informational" becomes a chat comment, and that
 * comment is unread exactly as long as its `chatNotifications/{projectId}/{userId}/{commentId}` doc
 * exists. Nothing ever deleted that doc because of something the user did in GMAIL: the app only
 * pushes state outwards (archiving from Alldone clears the comment, AT-2298), so reading or
 * archiving the mail in Gmail left the Alldone comment unread forever, and the user had to triage
 * the same email twice.
 *
 * There is no push channel for this. Gmail's own history API only reports label changes to a
 * mailbox-wide cursor, and the messages behind unread email comments are a tiny, known set — so
 * this asks the mailbox directly for those messages' current state and clears the comments whose
 * email has already been handled. It is strictly a *read* of the mailbox: nothing here writes to
 * Gmail, and the unread state of ordinary (non-email) chat comments is untouched.
 */

// Both backends are required lazily, exactly like linkedEmailActions does: this module is reached
// from a chat-list component, and a static import would pull the redux store and the Firebase
// client into every test (and every bundle chunk) that only renders a row.
//
// There is deliberately no offline pre-check here: `runHttpsCallableFunction` already throws a
// typed `offline` error instead of hanging, and this whole sync treats "could not ask" as "leave
// it unread" — so the offline case is the failure path that already exists.
const getEmailLineBackend = () => require('./emailLineBackend')
const getChatCommentsReadBackend = () => require('../Chats/markChatCommentsAsRead')

// How long a message's state is trusted before it is worth asking Gmail again. The chat list
// re-registers its previews on every snapshot, so without this the same lookup would run on every
// re-render.
export const EMAIL_COMMENT_READ_SYNC_COOLDOWN_MS = 60 * 1000

// The server caps a lookup at 200 ids; asking for more would silently drop the tail.
const MAX_MESSAGES_PER_CONNECTION = 200

// Bound on the cooldown bookkeeping so a long session cannot grow it without limit.
const MAX_TRACKED_MESSAGES = 2000

const lastCheckedAt = new Map()

/**
 * The product rule, in one place: an email counts as handled — and its Alldone comment as read —
 * when it is no longer unread, when it has left the inbox, or when it is gone from the mailbox
 * altogether. **Archived counts even while Gmail still flags the message UNREAD**: leaving the
 * inbox is the user saying they are done with it, which is exactly how Alldone's own archive
 * action already behaves (AT-2298).
 *
 * A state we could not read is never "handled" — the server omits those entirely, and anything
 * unexpected here answers false, so an unread comment can only ever be cleared on positive
 * evidence.
 */
export function isEmailHandledInMailbox(state, { archivedByLabeling = false, direction = '' } = {}) {
    if (!state || !state.messageId) return false
    if (state.exists === false) return true
    if (state.unread === false) return true
    if (state.inInbox === false) {
        // Two cases where leaving the inbox says nothing about the USER: the labeling sync
        // auto-archived the mail itself (it was already out of the inbox when the comment
        // appeared), and an outgoing message, which is never in the inbox at all. For those, only
        // "read" or "deleted" counts. Mirrors the server rule in
        // functions/Gmail/emailCommentReadSync.js — keep the two in step.
        if (archivedByLabeling) return false
        if (String(direction || '').toLowerCase() === 'outgoing') return false
        return true
    }
    return false
}

function getCommentRefs(linkedEmail = {}) {
    const refs = []
    const seen = new Set()

    const add = ref => {
        if (!ref?.projectId || !ref?.commentId) return
        const key = `${ref.projectId}:${ref.commentId}`
        if (seen.has(key)) return
        seen.add(key)
        refs.push({ projectId: ref.projectId, chatId: ref.chatId || '', commentId: ref.commentId })
    }

    ;(linkedEmail.commentRefs || []).forEach(add)
    add(linkedEmail)

    return refs
}

function rememberChecked(key, now) {
    if (lastCheckedAt.size >= MAX_TRACKED_MESSAGES) lastCheckedAt.clear()
    lastCheckedAt.set(key, now)
}

/**
 * Groups the linked emails by mail connection, dropping the ones that were checked recently
 * (unless `force`) and the ones that carry no comment to mark as read.
 */
function buildLookupPlan(linkedEmails, { force, now }) {
    const plan = new Map()

    ;(linkedEmails || []).forEach(linkedEmail => {
        const connectionProjectId = String(linkedEmail?.connectionProjectId || '').trim()
        const messageId = String(linkedEmail?.messageId || '').trim()
        if (!connectionProjectId || !messageId) return

        const commentRefs = getCommentRefs(linkedEmail)
        if (commentRefs.length === 0) return

        const cooldownKey = `${connectionProjectId}:${messageId}`
        if (!force && now - (lastCheckedAt.get(cooldownKey) || 0) < EMAIL_COMMENT_READ_SYNC_COOLDOWN_MS) return

        const connection = plan.get(connectionProjectId) || {
            messageIds: [],
            refsByMessageId: new Map(),
            contextByMessageId: new Map(),
        }
        if (!connection.contextByMessageId.has(messageId)) {
            connection.contextByMessageId.set(messageId, {
                archivedByLabeling: linkedEmail?.archivedByLabeling === true,
                direction: linkedEmail?.direction || '',
            })
        }
        const existingRefs = connection.refsByMessageId.get(messageId)
        if (existingRefs) {
            commentRefs.forEach(ref => {
                if (!existingRefs.some(known => known.projectId === ref.projectId && known.commentId === ref.commentId))
                    existingRefs.push(ref)
            })
        } else {
            connection.messageIds.push(messageId)
            connection.refsByMessageId.set(messageId, commentRefs)
        }
        plan.set(connectionProjectId, connection)
    })

    return plan
}

/**
 * Checks the given unread linked emails against their mailbox and marks the matching Alldone chat
 * comments as read. Returns how many comments were cleared.
 *
 * Never throws and never alerts: this runs behind a list the user is reading, so a mailbox that is
 * unreachable, offline or disconnected has to leave the unread state exactly as it is.
 */
export async function syncEmailCommentsReadState(linkedEmails = [], { force = false } = {}) {
    const now = Date.now()
    const plan = buildLookupPlan(linkedEmails, { force, now })
    if (plan.size === 0) return 0

    const refsToClear = []

    await Promise.all(
        [...plan.entries()].map(async ([connectionProjectId, connection]) => {
            const messageIds = connection.messageIds.slice(0, MAX_MESSAGES_PER_CONNECTION)
            let states
            try {
                states = await getEmailLineBackend().fetchEmailLineMessageStates(connectionProjectId, messageIds)
            } catch (error) {
                // Includes the offline and reconnect-required cases; both mean "we do not know",
                // and not knowing must never clear an unread comment.
                console.log('[emailCommentReadSync] Could not read mailbox state', error?.message || error)
                return
            }

            messageIds.forEach(messageId => rememberChecked(`${connectionProjectId}:${messageId}`, now))
            ;(states || []).forEach(state => {
                if (!isEmailHandledInMailbox(state, connection.contextByMessageId.get(state.messageId))) return
                const refs = connection.refsByMessageId.get(state.messageId)
                if (refs) refsToClear.push(...refs)
            })
        })
    )

    if (refsToClear.length === 0) return 0

    try {
        await getChatCommentsReadBackend().markChatCommentsAsRead(refsToClear)
    } catch (error) {
        console.log('[emailCommentReadSync] Could not mark email comments as read', error?.message || error)
        return 0
    }

    return refsToClear.length
}

// Test seam: the cooldown is module state on purpose (it must survive re-renders and remounts).
export function resetEmailCommentReadSyncCooldown() {
    lastCheckedAt.clear()
}
