'use strict'

const { buildEmailTaskUpdate } = require('./emailTaskContentUpdate')

// Decided 2026-11-09 (UNIFIED_INBOX_PLAN.md): a later email reopens a done email task only when it
// asks something of the user. A plain "thanks" becomes a comment and the task stays done.
describe('buildEmailTaskUpdate reopening', () => {
    const now = 1_700_000_000_000
    const doneTask = {
        done: true,
        inDone: true,
        userId: 'user-1',
        gmailData: { messageId: 'm1', lastEmailReceivedAt: 100, taskContent: {} },
    }
    const gmailData = { messageId: 'm2', receivedAt: 200 }

    test('keeps a done task done when the email asks nothing', () => {
        const update = buildEmailTaskUpdate(doneTask, { reopen: false }, gmailData, 'assistant-1', now)
        expect(update.done).toBeUndefined()
        expect(update.inDone).toBeUndefined()
        expect(update.gmailData.lastEmailReceivedAt).toBe(200)
    })

    test('reopens when the email needs the user', () => {
        const update = buildEmailTaskUpdate(doneTask, { reopen: true }, gmailData, 'assistant-1', now)
        expect(update.done).toBe(false)
        expect(update.inDone).toBe(false)
        expect(update.currentReviewerId).toBe('user-1')
    })

    test('reopens as before when the caller sends no flag', () => {
        const update = buildEmailTaskUpdate(doneTask, {}, gmailData, 'assistant-1', now)
        expect(update.done).toBe(false)
    })
})

describe('buildEmailTaskUpdate on a reply task', () => {
    const now = 1_700_000_000_000
    const replyTask = {
        done: false,
        inDone: false,
        userId: 'user-1',
        gmailData: { messageId: 'm1', lastEmailReceivedAt: 100, taskContent: {} },
        messageData: { provider: 'gmail', needsReply: false, lastMessageAt: 100, senderName: 'Lena' },
    }

    test('moves lastMessageAt and turns needsReply back on', () => {
        const update = buildEmailTaskUpdate(
            replyTask,
            { reopen: true, needsReply: true },
            { messageId: 'm2', receivedAt: 300 },
            'assistant-1',
            now
        )
        expect(update.messageData).toEqual({ ...replyTask.messageData, lastMessageAt: 300, needsReply: true })
    })

    test('leaves needsReply alone for a message that asks nothing', () => {
        const update = buildEmailTaskUpdate(
            replyTask,
            { reopen: false, needsReply: false },
            { messageId: 'm2', receivedAt: 300 },
            'assistant-1',
            now
        )
        expect(update.messageData.needsReply).toBe(false)
        expect(update.messageData.lastMessageAt).toBe(300)
    })

    test('ignores an older email', () => {
        const update = buildEmailTaskUpdate(
            { ...replyTask, gmailData: { ...replyTask.gmailData, lastEmailReceivedAt: 500 } },
            { reopen: true, needsReply: true },
            { messageId: 'm0', receivedAt: 50 },
            'assistant-1',
            now
        )
        expect(update.messageData).toBeUndefined()
    })
})

// AT-3131: FE-2149 and FE-2150 were ordinary email tasks visible to the whole family project. A
// later email in their thread that asks the owner for an answer now makes them reply tasks (into
// Messages), and they keep the visibility they had: the upgrade never makes a task private.
describe('buildEmailTaskUpdate upgrading an ordinary email task to a reply task', () => {
    const now = 1_700_000_000_000
    const ordinaryTask = {
        done: false,
        inDone: false,
        userId: 'user-1',
        userIds: ['user-1'],
        isPrivate: false,
        isPublicFor: [0, 'user-1'],
        gmailData: {
            provider: 'google',
            gmailEmail: 'owner@example.com',
            messageId: 'm1',
            threadId: 'thread-1',
            webUrl: 'https://mail.google.com/mail/u/0/#all/m1',
            lastEmailReceivedAt: 100,
            taskContent: {},
        },
    }
    const laterEmail = {
        provider: 'google',
        accountUserId: 'user-1',
        gmailEmail: 'owner@example.com',
        messageId: 'm2',
        threadId: 'thread-1',
        webUrl: 'https://mail.google.com/mail/u/0/#all/m2',
        receivedAt: 300,
    }
    const replyPlan = {
        reopen: true,
        needsReply: true,
        replySender: { name: 'Lesya über Kleinanzeigen', email: 'NoReply@mail.kleinanzeigen.de' },
    }

    test('adds messageData so the task enters Messages', () => {
        const update = buildEmailTaskUpdate(ordinaryTask, replyPlan, laterEmail, 'assistant-1', now)
        expect(update.messageData).toEqual({
            provider: 'gmail',
            kind: 'email',
            connectionKey: 'owner@example.com',
            conversationKey: 'thread-1',
            senderName: 'Lesya über Kleinanzeigen',
            senderEmail: 'noreply@mail.kleinanzeigen.de',
            lastMessageAt: 300,
            needsReply: true,
            webUrl: 'https://mail.google.com/mail/u/0/#all/m2',
        })
    })

    test.each([
        ['visible to the project', { isPrivate: false, isPublicFor: [0, 'user-1'] }],
        ['private', { isPrivate: true, isPublicFor: ['user-1'] }],
        ['without visibility fields', {}],
    ])('keeps the visibility of a task that is %s', (_, visibility) => {
        const { isPrivate, isPublicFor, ...withoutVisibility } = ordinaryTask
        const task = { ...withoutVisibility, ...visibility }
        const update = buildEmailTaskUpdate(task, replyPlan, laterEmail, 'assistant-1', now)
        expect(update.messageData?.needsReply).toBe(true)
        expect(update).not.toHaveProperty('isPrivate')
        expect(update).not.toHaveProperty('isPublicFor')
        expect({ ...task, ...update }).toMatchObject(visibility)
    })

    test('adds nothing when the later email asks nothing', () => {
        const update = buildEmailTaskUpdate(
            ordinaryTask,
            { reopen: false, needsReply: false },
            laterEmail,
            'assistant-1',
            now
        )
        expect(update).not.toHaveProperty('messageData')
    })

    test('adds nothing for an email older than the task’s last one', () => {
        const update = buildEmailTaskUpdate(
            ordinaryTask,
            replyPlan,
            { ...laterEmail, messageId: 'm0', receivedAt: 50 },
            'assistant-1',
            now
        )
        expect(update).not.toHaveProperty('messageData')
    })

    test('adds nothing to a task that belongs to someone other than the mailbox owner', () => {
        const update = buildEmailTaskUpdate(
            { ...ordinaryTask, userId: 'colleague', userIds: ['colleague'] },
            replyPlan,
            laterEmail,
            'assistant-1',
            now
        )
        expect(update).not.toHaveProperty('messageData')
    })

    test('adds nothing when the caller names no mailbox owner', () => {
        const { accountUserId, ...withoutOwner } = laterEmail
        const update = buildEmailTaskUpdate(ordinaryTask, replyPlan, withoutOwner, 'assistant-1', now)
        expect(update).not.toHaveProperty('messageData')
    })
})
