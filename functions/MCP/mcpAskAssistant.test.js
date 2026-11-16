const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { buildAssistantRunLockId } = require('../Assistant/assistantRunIdempotency')
const { askAssistant } = require('./mcpAskAssistant')

const P = 'p1'
const USER = 'karsten'
const CHAT = 'topic-1'

const seeded = (project = {}) =>
    createFakeFirestore({
        [`projects/${P}`]: { name: 'Alldone Growth', userIds: [USER], assistantId: 'growth-lead', ...project },
        [`users/${USER}`]: { displayName: 'Karsten' },
    })

// Stands in for add_chat_comment's topic writer: stores the user's comment as it would.
const topicPoster =
    db =>
    async ({ projectId, comment, userId, authorChannelFields, assistantRunRequest }) => {
        await db.doc(`chatComments/${projectId}/topics/${CHAT}/comments/c1`).set({
            creatorId: userId,
            commentText: comment,
            created: 1000,
            fromAssistant: false,
            assistantRunRequest: { ...assistantRunRequest, objectId: CHAT },
            ...authorChannelFields,
        })
        return { chatId: CHAT, commentId: 'c1', created: 1000 }
    }

const lockPath = commentId =>
    `assistantRunLocks/${buildAssistantRunLockId({ projectId: P, objectType: 'topics', objectId: CHAT, messageId: commentId })}`

describe('ask_assistant over MCP', () => {
    test("posts the question as the user's comment, starts the run at once and returns the answer", async () => {
        const db = seeded()
        let clock = 0
        const enqueue = jest.fn(async () => {
            // The worker runs the assistant: an answer in the thread, then the lock settles.
            await db.doc(`chatComments/${P}/topics/${CHAT}/comments/a1`).set({
                creatorId: 'growth-lead',
                fromAssistant: true,
                commentText: 'Three prospects found.',
                created: 2000,
            })
            await db.doc(lockPath('c1')).set({ status: 'completed' })
        })
        const result = await askAssistant(
            USER,
            { projectId: P, message: 'How did discovery go?' },
            { mcpClient: 'Claude' },
            { db, enqueue, postTopicComment: topicPoster(db), sleep: async () => (clock += 2000), now: () => clock }
        )

        expect(result).toMatchObject({
            status: 'answered',
            answer: 'Three prospects found.',
            assistantId: 'growth-lead',
            objectType: 'topics',
            objectId: CHAT,
            commentId: 'c1',
        })
        expect(enqueue).toHaveBeenCalledWith(
            { projectId: P, objectType: 'topics', objectId: CHAT, commentId: 'c1' },
            expect.objectContaining({
                creatorId: USER,
                via: 'mcp',
                viaClient: 'Claude',
                assistantRunRequest: { projectId: P, objectType: 'topics', objectId: CHAT, assistantId: 'growth-lead' },
            }),
            { delaySeconds: 0 }
        )
    })

    test('stops waiting when the time is up and says how to keep waiting', async () => {
        const db = seeded()
        let clock = 0
        const result = await askAssistant(
            USER,
            { projectId: P, message: 'Long job', waitSeconds: 4 },
            {},
            {
                db,
                enqueue: jest.fn(),
                postTopicComment: topicPoster(db),
                sleep: async () => (clock += 2000),
                now: () => clock,
            }
        )
        expect(result.status).toBe('starting')
        expect(result.hint).toMatch(/waitForCommentId/)

        await db.doc(lockPath('c1')).set({ status: 'failed', error: 'Out of Gold' })
        const again = await askAssistant(
            USER,
            { projectId: P, chatId: CHAT, waitForCommentId: 'c1', waitSeconds: 0 },
            {},
            { db, now: () => clock }
        )
        expect(again).toMatchObject({ status: 'failed', error: 'Out of Gold' })
    })

    test('asks only in projects the user belongs to, and needs an assistant', async () => {
        await expect(askAssistant('stranger', { projectId: P, message: 'Hi' }, {}, { db: seeded() })).rejects.toThrow(
            /not accessible/
        )
        await expect(
            askAssistant(USER, { projectId: P, message: 'Hi' }, {}, { db: seeded({ assistantId: '' }) })
        ).rejects.toThrow(/no project assistant/)
    })
})
