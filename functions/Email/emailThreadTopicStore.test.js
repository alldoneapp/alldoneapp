jest.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'ts' } }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    getBaseUrl: () => 'https://my.alldone.app',
}))

const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { getEmailIdentity } = require('./emailThreadIdentity')
const {
    appendSentMessageToThreadTopic,
    buildSentMessageText,
    buildThreadTopicCommentId,
    buildThreadTopicTitle,
    ensureEmailThreadTopic,
    getThreadTopicChatId,
    isIncomingConversationMessage,
    postTaskLinkInThreadTopic,
    resolveEmailThreadTopicForMessage,
} = require('./emailThreadTopicStore')

const OWNER = 'owner'
const PROJECT = 'project-a'
const AUDIT = `users/${OWNER}/private/gmailLabeling__conn/messages`

function identityFor(messageId, threadId = 'thread-1') {
    return getEmailIdentity(OWNER, { provider: 'google', gmailEmail: 'Me@Example.com', messageId, threadId })
}

function digestComment(messageId, text, created) {
    return {
        commentText: text,
        creatorId: 'assistant',
        fromAssistant: true,
        created,
        source: 'gmail_label_follow_up',
        gmailData: { messageId, threadId: 'thread-1', direction: 'incoming', gmailEmail: 'me@example.com' },
    }
}

function baseDatabase(extra = {}) {
    return createFakeFirestore({
        [`projects/${PROJECT}`]: { userIds: [OWNER] },
        [`projects/other`]: { userIds: [OWNER] },
        [`chatObjects/${PROJECT}/chats/digest`]: { type: 'topics', title: 'Daily emails A 09.11.2026' },
        [`chatComments/${PROJECT}/topics/digest/comments/c1`]: digestComment('m1', 'Email from Ann: offer', 100),
        [`${AUDIT}/m1`]: {
            gmailThreadId: 'thread-1',
            internalDate: 100,
            direction: 'incoming',
            emailComments: [{ projectId: PROJECT, chatId: 'digest', commentId: 'c1' }],
        },
        ...extra,
    })
}

const commentsIn = (db, projectId, chatId) =>
    [...db.docs.keys()].filter(key => key.startsWith(`chatComments/${projectId}/topics/${chatId}/comments/`))

describe('email thread topics', () => {
    test('the title is the subject without reply prefixes, else the sender', () => {
        expect(buildThreadTopicTitle({ subject: 'Re: AW: Fwd: Offer for Q4' })).toBe('Offer for Q4')
        expect(buildThreadTopicTitle({ subject: '', from: '"Ann Lee" <ann@x.com>' })).toBe(
            'Email conversation with Ann Lee'
        )
    })

    test('a sent message is shown as its decoded snippet, bounded', () => {
        expect(buildSentMessageText({ snippet: 'Thanks &amp; see you&#39;re fine' })).toBe("Thanks & see you're fine")
        expect(buildSentMessageText({ snippet: 'x'.repeat(500) })).toHaveLength(300)
        expect(buildSentMessageText({ snippet: '', subject: 'Offer' })).toBe('Sent: Offer')
    })

    test('the comment id matches the assistant tool so a line is never written twice', () => {
        const crypto = require('crypto')
        const expected = `gmail-${crypto.createHash('sha1').update('chat:m1').digest('hex').slice(0, 24)}`
        expect(buildThreadTopicCommentId('chat', 'm1')).toBe(expected)
    })

    describe('what makes an incoming email a conversation', () => {
        test('a plain reply from a person', () => {
            expect(isIncomingConversationMessage({ inReplyTo: '<a@x>' }, {})).toBe(true)
        })
        test('not a first email, and not a notification that merely threads', () => {
            expect(isIncomingConversationMessage({}, {})).toBe(false)
            expect(isIncomingConversationMessage({ inReplyTo: '<a@x>', listUnsubscribe: '<mailto:u@x>' }, {})).toBe(
                false
            )
        })
        test('anything in a thread the owner already wrote in', () => {
            expect(isIncomingConversationMessage({ listUnsubscribe: 'x' }, { ownerReplied: true })).toBe(true)
        })
    })

    test('an incoming reply creates one private topic and copies the earlier digest line, unread-free', async () => {
        const db = baseDatabase()
        const topic = await resolveEmailThreadTopicForMessage({
            database: db,
            identity: identityFor('m2'),
            auditCollectionRef: db.collection(AUDIT),
            normalizedMessage: { messageId: 'm2', subject: 'Re: Offer', inReplyTo: '<m1@x>' },
            allowIncomingPromotion: true,
            selectedProjectId: 'other',
            connectionProjectId: 'conn',
            resolveAssistantId: async () => 'assistant',
        })
        const chatId = getThreadTopicChatId(identityFor('m2'))
        // The conversation lives where it started (the digest line's project), not the new label's.
        expect(topic).toMatchObject({ projectId: PROJECT, chatId, created: true, promoted: true, seededCount: 1 })
        const chat = db.docs.get(`chatObjects/${PROJECT}/chats/${chatId}`)
        expect(chat).toMatchObject({
            title: 'Offer',
            type: 'topics',
            isPublicFor: [OWNER],
            usersFollowing: [OWNER],
            assistantId: 'assistant',
            emailThread: { threadId: 'thread-1', gmailEmail: 'me@example.com', connectionProjectId: 'conn' },
            commentsData: { amount: 1, lastComment: 'Email from Ann: offer' },
        })
        const copies = commentsIn(db, PROJECT, chatId)
        expect(copies).toEqual([
            `chatComments/${PROJECT}/topics/${chatId}/comments/${buildThreadTopicCommentId(chatId, 'm1')}`,
        ])
        expect(db.docs.get(copies[0])).toMatchObject({
            commentText: 'Email from Ann: offer',
            created: 100,
            copiedFromEmailDigest: { projectId: PROJECT, chatId: 'digest', commentId: 'c1' },
        })
        // The digest line stays where it is, and nothing new is unread.
        expect(db.docs.has(`chatComments/${PROJECT}/topics/digest/comments/c1`)).toBe(true)
        expect([...db.docs.keys()].some(key => key.startsWith('chatNotifications/'))).toBe(false)
        expect(db.docs.get(`users/${OWNER}/emailThreadTopics/${identityFor('m2').key}`)).toMatchObject({
            projectId: PROJECT,
            chatId,
        })
    })

    test('a rerun and a second message reuse the same topic without copying twice', async () => {
        const db = baseDatabase()
        const args = identity => ({
            database: db,
            identity,
            auditCollectionRef: db.collection(AUDIT),
            normalizedMessage: { subject: 'Re: Offer', inReplyTo: '<m1@x>' },
            allowIncomingPromotion: true,
        })
        const first = await resolveEmailThreadTopicForMessage(args(identityFor('m2')))
        await resolveEmailThreadTopicForMessage(args(identityFor('m2')))
        const third = await resolveEmailThreadTopicForMessage(args(identityFor('m3')))
        expect(third).toMatchObject({ projectId: first.projectId, chatId: first.chatId, created: false })
        expect(commentsIn(db, PROJECT, first.chatId)).toHaveLength(1)
        expect(db.docs.get(`chatObjects/${PROJECT}/chats/${first.chatId}`).commentsData.amount).toBe(1)
    })

    test('a first email and a newsletter stay in the digest', async () => {
        const db = baseDatabase()
        for (const normalizedMessage of [{ subject: 'Hello' }, { inReplyTo: '<x>', listUnsubscribe: '<u>' }]) {
            const topic = await resolveEmailThreadTopicForMessage({
                database: db,
                identity: identityFor('m9', 'thread-9'),
                auditCollectionRef: db.collection(AUDIT),
                normalizedMessage,
                allowIncomingPromotion: true,
                selectedProjectId: PROJECT,
            })
            expect(topic).toBeNull()
        }
        expect([...db.docs.keys()].some(key => key.includes('EmailThread_'))).toBe(false)
    })

    test('incoming mail is never promoted where the prompt does not write the digest', async () => {
        const db = baseDatabase()
        const topic = await resolveEmailThreadTopicForMessage({
            database: db,
            identity: identityFor('m2'),
            auditCollectionRef: db.collection(AUDIT),
            normalizedMessage: { inReplyTo: '<m1@x>' },
            allowIncomingPromotion: false,
        })
        expect(topic).toBeNull()
    })

    test('a thread without a threadId never groups', async () => {
        const db = baseDatabase()
        const identity = getEmailIdentity(OWNER, { gmailEmail: 'me@example.com', messageId: 'm2' })
        const topic = await resolveEmailThreadTopicForMessage({
            database: db,
            identity,
            auditCollectionRef: db.collection(AUDIT),
            normalizedMessage: { inReplyTo: '<m1@x>' },
            outgoing: true,
            allowIncomingPromotion: true,
            selectedProjectId: PROJECT,
        })
        expect(topic).toBeNull()
    })

    describe('sent mail', () => {
        test('answering a digest email starts the conversation; starting a new email creates nothing', async () => {
            const db = baseDatabase()
            const answered = await resolveEmailThreadTopicForMessage({
                database: db,
                identity: identityFor('s1'),
                auditCollectionRef: db.collection(AUDIT),
                normalizedMessage: { subject: 'Re: Offer' },
                outgoing: true,
            })
            expect(answered).toMatchObject({ projectId: PROJECT, promoted: true, seededCount: 1 })

            const started = await resolveEmailThreadTopicForMessage({
                database: db,
                identity: identityFor('s2', 'thread-new'),
                auditCollectionRef: db.collection(AUDIT),
                normalizedMessage: { subject: 'New idea' },
                outgoing: true,
            })
            expect(started).toBeNull()
        })

        test('is the owner own message, silent, and written once', async () => {
            const db = baseDatabase()
            const topic = await ensureEmailThreadTopic({
                database: db,
                identity: identityFor('s1'),
                projectId: PROJECT,
                normalizedMessage: { subject: 'Offer' },
            })
            const message = { messageId: 's1', snippet: 'Works for me', internalDate: 500 }
            const first = await appendSentMessageToThreadTopic({
                database: db,
                projectId: PROJECT,
                chatId: topic.chatId,
                userId: OWNER,
                normalizedMessage: message,
                gmailData: { messageId: 's1', threadId: 'thread-1' },
            })
            const again = await appendSentMessageToThreadTopic({
                database: db,
                projectId: PROJECT,
                chatId: topic.chatId,
                userId: OWNER,
                normalizedMessage: message,
                gmailData: { messageId: 's1', threadId: 'thread-1' },
            })
            expect(first.written).toBe(1)
            expect(again.written).toBe(0)
            const comment = db.docs.get(`chatComments/${PROJECT}/topics/${topic.chatId}/comments/${first.commentId}`)
            expect(comment).toMatchObject({
                commentText: 'Works for me',
                creatorId: OWNER,
                fromAssistant: false,
                created: 500,
                source: 'gmail_thread_sent',
                gmailData: { direction: 'outgoing' },
            })
            expect(db.docs.get(`chatObjects/${PROJECT}/chats/${topic.chatId}`).commentsData).toMatchObject({
                amount: 1,
                lastComment: 'Works for me',
                lastCommentOwnerId: OWNER,
            })
            expect([...db.docs.keys()].some(key => key.startsWith('chatNotifications/'))).toBe(false)
        })
    })

    test('a topic in a project the owner left is not reused, and no topic is created there', async () => {
        const db = baseDatabase({ [`projects/${PROJECT}`]: { userIds: ['someone-else'] } })
        const topic = await ensureEmailThreadTopic({
            database: db,
            identity: identityFor('m2'),
            projectId: PROJECT,
            normalizedMessage: {},
        })
        expect(topic).toBeNull()
    })

    test('a deleted topic is created again', async () => {
        const db = baseDatabase()
        const first = await ensureEmailThreadTopic({ database: db, identity: identityFor('m2'), projectId: PROJECT })
        db.docs.delete(`chatObjects/${PROJECT}/chats/${first.chatId}`)
        const again = await ensureEmailThreadTopic({ database: db, identity: identityFor('m3'), projectId: PROJECT })
        expect(again).toMatchObject({ chatId: first.chatId, created: true })
    })

    test('an actionable email in a conversation leaves a link to its task', async () => {
        const db = baseDatabase()
        const topic = await ensureEmailThreadTopic({ database: db, identity: identityFor('m2'), projectId: PROJECT })
        const result = await postTaskLinkInThreadTopic({
            database: db,
            projectId: PROJECT,
            chatId: topic.chatId,
            authorId: 'assistant',
            fromAssistant: true,
            task: { taskId: 't1', projectId: PROJECT, task: { name: 'Send the contract' } },
            messageId: 'm2',
        })
        expect(result.written).toBe(1)
        const [path] = commentsIn(db, PROJECT, topic.chatId)
        expect(db.docs.get(path).commentText).toBe(
            'Created task "Send the contract" from this email. Later replies continue on that task: https://my.alldone.app/projects/project-a/tasks/t1/chat'
        )
    })
})
