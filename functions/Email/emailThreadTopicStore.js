'use strict'

// One private chat topic per email conversation (Gmail labeling follow-ups).
//
// A first informational email nobody has answered is a line in the "Daily emails <project> <date>"
// topic. As soon as the thread is a conversation (a reply came in, or the owner replied), it gets a
// topic of its own: the earlier digest lines are copied into it, later incoming lines are routed
// there and the owner's own replies appear in it as the owner's messages. A thread that already has
// a task keeps using the task (emailThreadContinuation.js runs first).
//
// The topic is private to the mailbox owner. The registry pointer and the chat id are derived from
// the same identity as email thread tasks (emailThreadIdentity.js), so a missing threadId never
// groups unrelated mail and two messages of one thread can never create two topics.

const { createHash } = require('crypto')
const { Timestamp } = require('firebase-admin/firestore')

const { isProjectMemberData } = require('../shared/privacyAccess')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')

const THREAD_TOPIC_CHAT_ID_PREFIX = 'EmailThread_'
const SENT_COMMENT_MAX_LENGTH = 300
const MAX_SEED_COMMENTS = 50
const SUBJECT_PREFIX_PATTERN = /^\s*((re|fw|fwd|aw|wg|sv|vs|antw|tr|rv|r)\s*(\[\d+\])?\s*:\s*)+/i

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function getThreadTopicChatId(identity) {
    return `${THREAD_TOPIC_CHAT_ID_PREFIX}${identity.key.slice(0, 40)}`
}

function getRegistryRef(database, identity) {
    return database.doc(`users/${identity.ownerId}/emailThreadTopics/${identity.key}`)
}

// Must stay identical to buildDeterministicGmailChatCommentId in Assistant/assistantHelper.js:
// a copy, a routed line and a sent message of the same email land on the same comment id.
function buildThreadTopicCommentId(chatId, messageId) {
    const normalizedMessageId = normalizeString(messageId)
    if (!chatId || !normalizedMessageId) return ''
    return `gmail-${createHash('sha1').update(`${chatId}:${normalizedMessageId}`).digest('hex').slice(0, 24)}`
}

function getSenderName(from = '') {
    const value = normalizeString(from)
    const quoted = value.match(/^"?([^"<]+?)"?\s*</)
    if (quoted && quoted[1].trim()) return quoted[1].trim()
    return value.replace(/[<>]/g, '').trim()
}

function buildThreadTopicTitle(normalizedMessage = {}) {
    const subject = normalizeString(normalizedMessage.subject).replace(SUBJECT_PREFIX_PATTERN, '').trim()
    if (subject) return subject.length > 150 ? `${subject.slice(0, 147).trimEnd()}...` : subject
    const sender = getSenderName(normalizedMessage.from)
    return sender ? `Email conversation with ${sender}` : 'Email conversation'
}

function decodeSnippet(snippet = '') {
    return String(snippet || '')
        .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
}

// The text of a message the owner sent. Gmail's snippet starts with the new text, ahead of any
// quote, and never contains the full body, which keeps the stored comment short.
function buildSentMessageText(normalizedMessage = {}) {
    const text = decodeSnippet(normalizedMessage.snippet)
    if (text) return text.length > SENT_COMMENT_MAX_LENGTH ? `${text.slice(0, SENT_COMMENT_MAX_LENGTH - 3)}...` : text
    const subject = normalizeString(normalizedMessage.subject)
    return subject ? `Sent: ${subject}` : 'Sent an email'
}

// The line of a received email a task was created from (AT-3022): sender and date like the
// continuation lines of later mail, then the provider's snippet instead of a model summary, so it
// costs no Gold and never stores the full body.
function buildReceivedMessageText(normalizedMessage = {}) {
    const from = normalizeString(normalizedMessage.from).slice(0, 200)
    const date = normalizeString(normalizedMessage.date).slice(0, 80)
    const snippet = decodeSnippet(normalizedMessage.snippet)
    const subject = normalizeString(normalizedMessage.subject)
    const text = snippet
        ? snippet.length > SENT_COMMENT_MAX_LENGTH
            ? `${snippet.slice(0, SENT_COMMENT_MAX_LENGTH - 3)}...`
            : snippet
        : subject || 'Email received'
    const prefix = `${from}${date ? ` (${date})` : ''}`
    return prefix ? `${prefix}: ${text}` : text
}

async function isOwnerProjectMember(database, projectId, userId) {
    if (!projectId) return false
    const snapshot = await database.doc(`projects/${projectId}`).get()
    return snapshot.exists && isProjectMemberData(snapshot.data(), userId)
}

/**
 * The thread's topic, when it still exists in a project the owner belongs to.
 */
async function getEmailThreadTopic({ database, identity }) {
    if (!identity?.threadId) return null
    const pointer = await getRegistryRef(database, identity).get()
    if (!pointer.exists) return null
    const { projectId, chatId } = pointer.data() || {}
    if (!projectId || !chatId) return null
    const [chatSnapshot, isMember] = await Promise.all([
        database.doc(`chatObjects/${projectId}/chats/${chatId}`).get(),
        isOwnerProjectMember(database, projectId, identity.ownerId),
    ])
    if (!chatSnapshot.exists || !isMember) return null
    return { projectId, chatId, created: false }
}

/**
 * The digest comments written for other messages of this thread, oldest first, read through the
 * labeling audit records (`gmailThreadId`, `emailComments`). Also tells whether any other message of
 * the thread was processed at all, which is what makes the thread a conversation.
 */
async function findThreadHistory({ auditCollectionRef, threadId, messageId }) {
    const normalizedThreadId = normalizeString(threadId)
    if (!auditCollectionRef || !normalizedThreadId)
        return { otherMessageCount: 0, ownerReplied: false, commentRefs: [] }
    const snapshot = await auditCollectionRef.where('gmailThreadId', '==', normalizedThreadId).get()
    const others = snapshot.docs
        .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
        .filter(audit => audit.id !== messageId)
        .sort((first, second) => (Number(first.internalDate) || 0) - (Number(second.internalDate) || 0))
    const seen = new Set()
    const commentRefs = []
    for (const audit of others) {
        for (const ref of Array.isArray(audit.emailComments) ? audit.emailComments : []) {
            if (!ref?.projectId || !ref?.chatId || !ref?.commentId) continue
            const key = `${ref.projectId}/${ref.chatId}/${ref.commentId}`
            if (seen.has(key)) continue
            seen.add(key)
            commentRefs.push({ projectId: ref.projectId, chatId: ref.chatId, commentId: ref.commentId })
        }
    }
    return {
        otherMessageCount: others.length,
        ownerReplied: others.some(audit => audit.direction === 'outgoing'),
        commentRefs,
    }
}

function buildThreadTopicChatData({ identity, chatId, title, emailThread, assistantId, now }) {
    const ownerId = identity.ownerId
    return {
        id: chatId,
        title,
        type: 'topics',
        // A whole conversation, the owner's own replies included, is personal mail: never shared
        // with the project and therefore never a wiki source.
        isPublicFor: [ownerId],
        assistantId: assistantId || null,
        creatorId: ownerId,
        created: now,
        lastEditionDate: now,
        lastEditorId: ownerId,
        usersFollowing: [ownerId],
        members: [ownerId],
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: assistantId || ownerId,
            lastCommentType: STAYWARD_COMMENT,
        },
        isAssistantEnabled: true,
        emailThread: {
            key: identity.key,
            threadId: identity.threadId,
            provider: identity.provider,
            gmailEmail: identity.email,
            connectionProjectId: normalizeString(emailThread?.connectionProjectId),
            subject: normalizeString(emailThread?.subject).slice(0, 300),
        },
    }
}

/**
 * Creates the thread's topic once. The registry pointer and the chat document commit together,
 * so two messages of the same thread racing here end up in the same topic.
 */
async function ensureEmailThreadTopic({
    database,
    identity,
    projectId,
    normalizedMessage,
    connectionProjectId,
    assistantId,
}) {
    if (!identity?.threadId || !projectId) return null
    if (!(await isOwnerProjectMember(database, projectId, identity.ownerId))) return null
    const chatId = getThreadTopicChatId(identity)
    const registryRef = getRegistryRef(database, identity)
    const chatRef = database.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const now = Date.now()

    const result = await database.runTransaction(async transaction => {
        const pointer = await transaction.get(registryRef)
        if (pointer.exists) {
            const registered = pointer.data() || {}
            if (registered.projectId && registered.chatId) {
                const existingChat = await transaction.get(
                    database.doc(`chatObjects/${registered.projectId}/chats/${registered.chatId}`)
                )
                // Sticky like email thread tasks: a later message routed to another project keeps
                // the conversation where it started.
                if (existingChat.exists) {
                    return { projectId: registered.projectId, chatId: registered.chatId, created: false }
                }
            }
        }
        const chatSnapshot = await transaction.get(chatRef)
        if (!chatSnapshot.exists) {
            transaction.set(
                chatRef,
                buildThreadTopicChatData({
                    identity,
                    chatId,
                    title: buildThreadTopicTitle(normalizedMessage),
                    emailThread: { connectionProjectId, subject: normalizedMessage?.subject },
                    assistantId,
                    now,
                })
            )
        }
        transaction.set(registryRef, {
            projectId,
            chatId,
            threadId: identity.threadId,
            subject: normalizeString(normalizedMessage?.subject).slice(0, 300),
            createdAt: now,
        })
        return { projectId, chatId, created: !chatSnapshot.exists }
    })

    if (result.created) {
        const ownerId = identity.ownerId
        await Promise.all([
            database.doc(`followers/${projectId}/topics/${chatId}`).set({ usersFollowing: [ownerId] }, { merge: true }),
            database
                .doc(`usersFollowing/${projectId}/entries/${ownerId}`)
                .set({ topics: { [chatId]: true } }, { merge: true }),
        ])
    }
    return result
}

/**
 * Writes comments into a thread topic without notifying anybody: copies of earlier digest lines and
 * the owner's own sent messages. Comment ids are deterministic, so a rerun writes nothing.
 */
async function writeSilentThreadComments({ database, projectId, chatId, comments }) {
    const entries = comments.filter(entry => entry?.commentId && entry?.data)
    if (!entries.length) return { written: 0 }
    const chatRef = database.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const refs = entries.map(entry =>
        database.doc(`chatComments/${projectId}/topics/${chatId}/comments/${entry.commentId}`)
    )

    return database.runTransaction(async transaction => {
        const chatSnapshot = await transaction.get(chatRef)
        if (!chatSnapshot.exists) throw new Error('Email thread topic no longer exists')
        const existing = await Promise.all(refs.map(ref => transaction.get(ref)))
        const toWrite = entries.filter((entry, index) => !existing[index].exists)
        if (!toWrite.length) return { written: 0 }

        toWrite.forEach(entry => {
            transaction.set(
                database.doc(`chatComments/${projectId}/topics/${chatId}/comments/${entry.commentId}`),
                entry.data
            )
        })
        const chat = chatSnapshot.data() || {}
        const commentsData = chat.commentsData && typeof chat.commentsData === 'object' ? chat.commentsData : {}
        const newest = [...toWrite].sort((a, b) => (Number(b.data.created) || 0) - (Number(a.data.created) || 0))[0]
        const isNewestOverall = (Number(newest.data.created) || 0) >= (Number(chat.lastEditionDate) || 0)
        transaction.update(chatRef, {
            commentsData: {
                ...commentsData,
                amount: (Number(commentsData.amount) || 0) + toWrite.length,
                ...(isNewestOverall || !commentsData.lastComment
                    ? {
                          lastComment: String(newest.data.commentText || '').substring(0, 200),
                          lastCommentOwnerId: newest.data.creatorId || commentsData.lastCommentOwnerId || '',
                          lastCommentType: STAYWARD_COMMENT,
                      }
                    : {}),
            },
            lastEditionDate: Math.max(Number(chat.lastEditionDate) || 0, Number(newest.data.created) || 0),
        })
        return { written: toWrite.length }
    })
}

/**
 * Copies the thread's earlier digest lines into its new topic. The digest lines stay where they
 * are, with their own unread and read-sync state; the copies are read from the start.
 */
async function seedEmailThreadTopic({ database, projectId, chatId, commentRefs = [] }) {
    const refs = commentRefs.slice(0, MAX_SEED_COMMENTS)
    if (!refs.length) return { written: 0 }
    const snapshots = await Promise.all(
        refs.map(ref =>
            database.doc(`chatComments/${ref.projectId}/topics/${ref.chatId}/comments/${ref.commentId}`).get()
        )
    )
    const comments = snapshots.flatMap((snapshot, index) => {
        if (!snapshot.exists) return []
        const data = snapshot.data() || {}
        const commentId =
            buildThreadTopicCommentId(chatId, data.gmailData?.messageId) || `copy-${refs[index].commentId}`
        const { assistantRunRequest, suppressAssistantReply, ...rest } = data
        return [
            {
                commentId,
                data: {
                    ...rest,
                    lastChangeDate: Timestamp.now(),
                    copiedFromEmailDigest: { ...refs[index] },
                },
            },
        ]
    })
    return writeSilentThreadComments({ database, projectId, chatId, comments })
}

/**
 * The owner's own reply, shown as their message in the thread topic. No model, no Gold, no unread
 * state: there is nothing for the owner to read.
 */
async function appendSentMessageToThreadTopic({ database, projectId, chatId, userId, normalizedMessage, gmailData }) {
    const commentId = buildThreadTopicCommentId(chatId, normalizedMessage?.messageId)
    if (!commentId) return { written: 0 }
    const text = buildSentMessageText(normalizedMessage)
    const result = await writeSilentThreadComments({
        database,
        projectId,
        chatId,
        comments: [
            {
                commentId,
                data: {
                    commentText: text,
                    originalContent: text,
                    commentType: STAYWARD_COMMENT,
                    lastChangeDate: Timestamp.now(),
                    created: Number(normalizedMessage?.internalDate) || Date.now(),
                    creatorId: userId,
                    fromAssistant: false,
                    source: 'gmail_thread_sent',
                    gmailData: { ...gmailData, direction: 'outgoing' },
                },
            },
        ],
    })
    return { ...result, commentId }
}

/**
 * A line in the thread topic pointing at the task an actionable email created, so the conversation
 * does not silently move elsewhere. Later mail of the thread continues on that task.
 */
async function postTaskLinkInThreadTopic({ database, projectId, chatId, authorId, fromAssistant, task, messageId }) {
    if (!task?.taskId) return { written: 0 }
    const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
    const url = `${getBaseUrl()}/projects/${task.projectId}/tasks/${task.taskId}/chat`
    const taskName = normalizeString(task.taskName || task.task?.name || task.task?.extendedName) || 'a task'
    const text = `Created task "${taskName.slice(0, 200)}" from this email. Later replies continue on that task: ${url}`
    return writeSilentThreadComments({
        database,
        projectId,
        chatId,
        comments: [
            {
                commentId: `task-${createHash('sha1')
                    .update(`${chatId}:${task.taskId}:${messageId || ''}`)
                    .digest('hex')
                    .slice(0, 24)}`,
                data: {
                    commentText: text,
                    originalContent: text,
                    commentType: STAYWARD_COMMENT,
                    lastChangeDate: Timestamp.now(),
                    created: Date.now(),
                    creatorId: authorId,
                    fromAssistant: !!fromAssistant,
                    source: 'gmail_thread_task_link',
                },
            },
        ],
    })
}

/**
 * Whether an incoming message makes its thread a conversation. Gmail also threads unrelated mail by
 * subject (order confirmations, weekly digests), and notification mail often carries In-Reply-To
 * (GitHub, ticket systems), so neither the thread alone nor the reply headers alone are enough:
 * either the owner already wrote in this thread, or the message is a reply that is not bulk mail.
 */
function isIncomingConversationMessage(normalizedMessage = {}, history = {}) {
    if (history.ownerReplied) return true
    const isReply = !!normalizeString(normalizedMessage.inReplyTo) || !!normalizeString(normalizedMessage.references)
    return isReply && !normalizeString(normalizedMessage.listUnsubscribe)
}

/**
 * The topic a labeled message belongs to, creating and seeding it when this message turns the thread
 * into a conversation. Returns null when the message stays a digest line (incoming) or has nowhere
 * to go (outgoing). Never creates a topic for a thread with no threadId.
 *
 * Outgoing mail only joins conversations Alldone already shows: an existing topic, or a thread with
 * digest lines, i.e. an email the owner is answering. Mail the owner starts creates nothing.
 */
async function resolveEmailThreadTopicForMessage({
    database,
    identity,
    auditCollectionRef,
    normalizedMessage,
    outgoing = false,
    allowIncomingPromotion = false,
    selectedProjectId = '',
    connectionProjectId = '',
    // Only asked when a topic is actually created, so the common digest case costs no lookup.
    resolveAssistantId = async () => null,
}) {
    if (!identity?.threadId) return null
    const existing = await getEmailThreadTopic({ database, identity })
    if (existing) return existing
    if (!outgoing && !allowIncomingPromotion) return null

    const history = await findThreadHistory({
        auditCollectionRef,
        threadId: identity.threadId,
        messageId: identity.messageId,
    })
    let projectId = history.commentRefs[0]?.projectId || ''
    if (outgoing) {
        if (!projectId) return null
    } else {
        if (!isIncomingConversationMessage(normalizedMessage, history)) return null
        projectId = projectId || normalizeString(selectedProjectId)
        if (!projectId) return null
    }

    const topic = await ensureEmailThreadTopic({
        database,
        identity,
        projectId,
        normalizedMessage,
        connectionProjectId,
        assistantId: (await resolveAssistantId()) || null,
    })
    if (!topic) return null
    const seeded = await seedEmailThreadTopic({
        database,
        projectId: topic.projectId,
        chatId: topic.chatId,
        commentRefs: history.commentRefs,
    })
    return { ...topic, promoted: true, seededCount: seeded.written || 0 }
}

module.exports = {
    isIncomingConversationMessage,
    resolveEmailThreadTopicForMessage,
    THREAD_TOPIC_CHAT_ID_PREFIX,
    appendSentMessageToThreadTopic,
    buildReceivedMessageText,
    buildSentMessageText,
    buildThreadTopicCommentId,
    buildThreadTopicTitle,
    ensureEmailThreadTopic,
    findThreadHistory,
    getEmailThreadTopic,
    getThreadTopicChatId,
    postTaskLinkInThreadTopic,
    seedEmailThreadTopic,
}
