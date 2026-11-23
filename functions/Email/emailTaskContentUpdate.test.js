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

    test('adds no messageData to an ordinary email task', () => {
        const { messageData, ...ordinary } = replyTask
        const update = buildEmailTaskUpdate(
            ordinary,
            { reopen: true, needsReply: true },
            { messageId: 'm2', receivedAt: 300 },
            'a',
            now
        )
        expect(update.messageData).toBeUndefined()
    })
})
