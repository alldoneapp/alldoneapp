jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }))

const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { buildAssistantRunLockId } = require('../Assistant/assistantRunIdempotency')
const { runMissedAssistantRun } = require('../Assistant/assistantMissedRunCatchUp')
const { askAssistant } = require('./mcpAskAssistant')

const P = 'p1'
const USER = 'karsten'
const CHAT = 'topic-1'
const TASK = 'task-1'
const CTO = 'cto'

const seeded = (project = {}, extra = {}) =>
    createFakeFirestore({
        [`projects/${P}`]: {
            name: 'Alldone Growth',
            userIds: [USER, 'colleague'],
            assistantId: 'growth-lead',
            ...project,
        },
        [`users/${USER}`]: { displayName: 'Karsten', language: 'de' },
        [`assistants/${P}/items/growth-lead`]: { displayName: 'Growth Lead' },
        [`assistants/${P}/items/${CTO}`]: { displayName: 'Alldone CTO' },
        [`assistants/${P}/items/thread-assistant`]: { displayName: 'Thread Assistant' },
        ...extra,
    })

// What MCP create_task stores: the assistant switched off and none chosen (the AT-3059 report).
const mcpCreatedTask = (overrides = {}) => ({
    [`items/${P}/tasks/${TASK}`]: {
        name: 'Chat queue only for a VM in the same object',
        userId: USER,
        isPublicFor: [0, USER],
        isAssistantEnabled: false,
        assistantId: '',
        ...overrides,
    },
})

// Stands in for add_chat_comment's topic writer: stores the user's comment and the topic as it would.
const topicPoster =
    db =>
    async ({ projectId, comment, userId, authorChannelFields, assistantRunRequest, topicAssistantId }) => {
        await db.doc(`chatObjects/${projectId}/chats/${CHAT}`).set({
            type: 'topics',
            isPublicFor: [0],
            isAssistantEnabled: true,
            assistantId: topicAssistantId,
        })
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

const lockPath = (commentId, objectType = 'topics', objectId = CHAT) =>
    `assistantRunLocks/${buildAssistantRunLockId({ projectId: P, objectType, objectId, messageId: commentId })}`

const taskComments = db =>
    [...db.docs.entries()]
        .filter(([key]) => key.startsWith(`chatComments/${P}/tasks/${TASK}/comments/`))
        .map(([key, data]) => ({ id: key.split('/').pop(), ...data }))

// The real server path behind ask_assistant: the queued check (assistantMissedRunCatchUp.js) runs at
// once against the same database. Only the model call is a stand-in, which writes the answer the way
// a run does (an assistant comment in the thread); everything around it is the production code.
const serverRun = (db, { answer = 'Done: queue only waits for the same object.', before } = {}) => {
    const askToBot = jest.fn(async (userId, commentId, projectId, objectType, objectId, ...rest) => {
        await db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/answer-${commentId}`).set({
            creatorId: rest[3],
            fromAssistant: true,
            commentText: answer,
            created: Date.now() + 1,
        })
    })
    const enqueue = jest.fn(async params => {
        if (before) await before(params)
        await runMissedAssistantRun(params, { db, askToBot })
        return { enqueued: true }
    })
    return { askToBot, enqueue }
}

const fastClock = () => {
    let clock = Date.now()
    return { sleep: async () => (clock += 2000), now: () => clock }
}

describe('ask_assistant over MCP', () => {
    // The catch-up logs every run it starts from the server; expected here.
    beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}))
    afterEach(() => jest.restoreAllMocks())

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
        expect(result.hint).toBeUndefined()
        expect(enqueue).toHaveBeenCalledWith(
            { projectId: P, objectType: 'topics', objectId: CHAT, commentId: 'c1' },
            expect.objectContaining({
                creatorId: USER,
                via: 'mcp',
                viaClient: 'Claude',
                assistantRunRequest: {
                    projectId: P,
                    objectType: 'topics',
                    objectId: CHAT,
                    assistantId: 'growth-lead',
                    startOnServer: true,
                },
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

    test('asks only in projects the user belongs to, and needs an assistant that exists', async () => {
        await expect(askAssistant('stranger', { projectId: P, message: 'Hi' }, {}, { db: seeded() })).rejects.toThrow(
            /not accessible/
        )
        await expect(
            askAssistant(USER, { projectId: P, message: 'Hi' }, {}, { db: seeded({ assistantId: '' }) })
        ).rejects.toThrow(/no project assistant/)
        await expect(
            askAssistant(USER, { projectId: P, message: 'Hi' }, {}, { db: seeded({ assistantId: 'deleted' }) })
        ).rejects.toThrow(/no project assistant/)
        const db = seeded()
        await expect(
            askAssistant(USER, { projectId: P, message: 'Hi', assistantId: 'other-projects-assistant' }, {}, { db })
        ).rejects.toThrow(/Assistant not found in this project/)
    })

    test('accepts an assistant of the global pool', async () => {
        const db = seeded({}, { 'assistants/globalProject/items/anna': { displayName: 'Anna' } })
        const result = await askAssistant(
            USER,
            { projectId: P, message: 'Hi', assistantId: 'anna', waitSeconds: 0 },
            {},
            { db, enqueue: jest.fn(), postTopicComment: topicPoster(db) }
        )
        expect(result.assistantId).toBe('anna')
    })

    describe('in a task whose assistant is switched off (AT-3059)', () => {
        test('switches it on and gives it the assistant asked, then the server run answers', async () => {
            const db = seeded({}, mcpCreatedTask())
            const { askToBot, enqueue } = serverRun(db)
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, assistantId: CTO, message: 'Please implement the description.' },
                { mcpClient: 'Claude' },
                { db, enqueue, ...fastClock() }
            )

            expect(result).toMatchObject({
                status: 'answered',
                answer: 'Done: queue only waits for the same object.',
                assistantId: CTO,
                objectType: 'tasks',
                objectId: TASK,
                assistantSwitchedOn: true,
            })
            const task = db.docs.get(`items/${P}/tasks/${TASK}`)
            expect(task).toMatchObject({ isAssistantEnabled: true, assistantId: CTO })
            // setTaskAssistant's counterpart: the task's chat names the same assistant.
            expect(db.docs.get(`chatObjects/${P}/chats/${TASK}`).assistantId).toBe(CTO)
            // The run is the ordinary one: for the asking user, with the assistant asked.
            expect(askToBot).toHaveBeenCalledTimes(1)
            expect(askToBot.mock.calls[0][0]).toBe(USER)
            expect(askToBot.mock.calls[0][8]).toBe(CTO)
            expect(db.docs.get(lockPath(result.commentId, 'tasks', TASK)).status).toBe('completed')
        })

        test("uses and keeps the task's own assistant when none is named", async () => {
            const db = seeded({}, mcpCreatedTask({ assistantId: 'thread-assistant' }))
            const { askToBot, enqueue } = serverRun(db)
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, message: 'Status?' },
                {},
                { db, enqueue, ...fastClock() }
            )
            expect(result.status).toBe('answered')
            expect(askToBot.mock.calls[0][8]).toBe('thread-assistant')
            expect(db.docs.get(`items/${P}/tasks/${TASK}`)).toMatchObject({
                isAssistantEnabled: true,
                assistantId: 'thread-assistant',
            })
        })

        test('a named assistant answers this question only; the task keeps its own', async () => {
            const db = seeded({}, mcpCreatedTask({ assistantId: 'thread-assistant', isAssistantEnabled: true }))
            const { askToBot, enqueue } = serverRun(db)
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, assistantId: CTO, message: 'Review this.' },
                {},
                { db, enqueue, ...fastClock() }
            )
            expect(result.status).toBe('answered')
            expect(result.assistantSwitchedOn).toBeUndefined()
            expect(askToBot.mock.calls[0][8]).toBe(CTO)
            expect(db.docs.get(`items/${P}/tasks/${TASK}`).assistantId).toBe('thread-assistant')
        })

        test('replaces a task assistant that no longer exists, as the bot button does', async () => {
            const db = seeded({}, mcpCreatedTask({ assistantId: 'deleted-assistant' }))
            const { askToBot, enqueue } = serverRun(db)
            await askAssistant(USER, { projectId: P, taskId: TASK, message: 'Hi' }, {}, { db, enqueue, ...fastClock() })
            expect(askToBot.mock.calls[0][8]).toBe('growth-lead')
            expect(db.docs.get(`items/${P}/tasks/${TASK}`).assistantId).toBe('growth-lead')
        })

        test('an automatic assistant comment right after the question does not swallow it', async () => {
            // Goal routing comments on a fresh task within seconds, often after the question.
            const db = seeded({}, mcpCreatedTask())
            const { askToBot, enqueue } = serverRun(db, {
                before: async () =>
                    db.doc(`chatComments/${P}/tasks/${TASK}/comments/goal-routing`).set({
                        creatorId: 'routing-assistant',
                        fromAssistant: true,
                        commentText: 'I assigned this task to a goal.',
                        created: Date.now() + 1,
                    }),
            })
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, assistantId: CTO, message: 'Go' },
                {},
                { db, enqueue, ...fastClock() }
            )
            expect(askToBot).toHaveBeenCalledTimes(1)
            expect(result.status).toBe('answered')
        })
    })

    describe('a run the server does not start ends the wait with its reason', () => {
        test('the assistant switched off again before the run started', async () => {
            const db = seeded({}, mcpCreatedTask())
            const { askToBot, enqueue } = serverRun(db, {
                before: async () => db.doc(`items/${P}/tasks/${TASK}`).update({ isAssistantEnabled: false }),
            })
            const clock = fastClock()
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, assistantId: CTO, message: 'Go', waitSeconds: 120 },
                {},
                { db, enqueue, ...clock }
            )
            expect(askToBot).not.toHaveBeenCalled()
            expect(result).toMatchObject({
                status: 'not_started',
                reason: 'assistant_disabled',
                error: expect.stringMatching(/switched off/),
                hint: expect.stringMatching(/ask again/),
            })
            // Returned on the first poll, not after waitSeconds.
            expect(clock.now() - Date.now()).toBeLessThan(5000)

            const again = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, waitForCommentId: result.commentId, waitSeconds: 120 },
                {},
                { db, ...fastClock() }
            )
            expect(again).toMatchObject({ status: 'not_started', reason: 'assistant_disabled' })
        })

        test('a later user message came first', async () => {
            const db = seeded({}, mcpCreatedTask())
            const { enqueue } = serverRun(db, {
                before: async () =>
                    db.doc(`chatComments/${P}/tasks/${TASK}/comments/later`).set({
                        creatorId: 'colleague',
                        fromAssistant: false,
                        commentText: 'And also this',
                        created: Date.now() + 1,
                    }),
            })
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, message: 'Go' },
                {},
                { db, enqueue, ...fastClock() }
            )
            expect(result).toMatchObject({ status: 'not_started', reason: 'superseded' })
            expect(result.hint).toMatch(/thread/)
        })

        test('a deleted question', async () => {
            const db = seeded({}, mcpCreatedTask())
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, message: 'Go' },
                {},
                {
                    db,
                    enqueue: async params =>
                        db
                            .doc(`chatComments/${P}/tasks/${TASK}/comments/${params.commentId}`)
                            .delete()
                            .then(() => ({ enqueued: true })),
                    ...fastClock(),
                }
            )
            expect(result).toMatchObject({ status: 'not_started', reason: 'missing' })
        })

        test('a run lock wins over a recorded skip', async () => {
            const db = seeded()
            const enqueue = jest.fn(async () => {
                await db.doc(`chatComments/${P}/topics/${CHAT}/comments/c1`).update({
                    assistantRunSkipped: { reason: 'superseded', at: 1 },
                })
                await db.doc(lockPath('c1')).set({ status: 'running' })
            })
            const result = await askAssistant(
                USER,
                { projectId: P, message: 'Hi', waitSeconds: 2 },
                {},
                { db, enqueue, postTopicComment: topicPoster(db), ...fastClock() }
            )
            expect(result.status).toBe('working')
        })

        test('the queue refusing the request', async () => {
            const db = seeded()
            const result = await askAssistant(
                USER,
                { projectId: P, message: 'Hi' },
                {},
                { db, enqueue: async () => ({ skipped: true }), postTopicComment: topicPoster(db), ...fastClock() }
            )
            expect(result).toMatchObject({ status: 'not_started', reason: 'not_requested' })
        })
    })

    describe('access', () => {
        test('never writes into a task the user cannot open', async () => {
            const db = seeded({}, mcpCreatedTask({ userId: 'colleague', isPublicFor: ['colleague'] }))
            const enqueue = jest.fn()
            await expect(
                askAssistant(USER, { projectId: P, taskId: TASK, message: 'Hi' }, {}, { db, enqueue })
            ).rejects.toThrow(/Task not found/)
            expect(db.writes).toEqual([])
            expect(enqueue).not.toHaveBeenCalled()
        })

        test('refuses a webhook task, whose assistant never answers, before writing anything', async () => {
            const db = seeded({}, mcpCreatedTask({ taskMetadata: { isWebhookTask: true } }))
            await expect(
                askAssistant(USER, { projectId: P, taskId: TASK, message: 'Hi' }, {}, { db, enqueue: jest.fn() })
            ).rejects.toThrow(/webhook/)
            expect(db.writes).toEqual([])
        })

        test.each([
            ['chatId', { chatId: 'private-topic' }],
            ['chatTitle', { chatTitle: 'Salary talks' }],
        ])('never writes into a topic the user cannot open (by %s)', async (_, where) => {
            const db = seeded(
                {},
                {
                    [`chatObjects/${P}/chats/private-topic`]: {
                        type: 'topics',
                        title: 'Salary talks',
                        isPublicFor: ['colleague'],
                        isAssistantEnabled: false,
                    },
                }
            )
            const postTopicComment = jest.fn()
            await expect(
                askAssistant(USER, { projectId: P, message: 'Hi', ...where }, {}, { db, postTopicComment })
            ).rejects.toThrow(/Topic not found/)
            expect(postTopicComment).not.toHaveBeenCalled()
            expect(db.writes).toEqual([])
        })

        test('switches the assistant on in an existing topic, by chatId or by title', async () => {
            for (const where of [{ chatId: 'quiet-topic' }, { chatTitle: 'Quiet topic' }]) {
                const db = seeded(
                    {},
                    {
                        [`chatObjects/${P}/chats/quiet-topic`]: {
                            type: 'topics',
                            title: 'Quiet topic',
                            isPublicFor: [0],
                            isAssistantEnabled: false,
                            assistantId: null,
                        },
                    }
                )
                const postTopicComment = jest.fn(async ({ chatId }) => ({ chatId, commentId: 'c1', created: 1 }))
                const result = await askAssistant(
                    USER,
                    { projectId: P, message: 'Hi', waitSeconds: 0, ...where },
                    {},
                    { db, postTopicComment, enqueue: jest.fn() }
                )
                expect(postTopicComment).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'quiet-topic' }))
                expect(result.assistantSwitchedOn).toBe(true)
                expect(db.docs.get(`chatObjects/${P}/chats/quiet-topic`)).toMatchObject({
                    isAssistantEnabled: true,
                    assistantId: 'growth-lead',
                })
            }
        })

        test('stops answering waits in a thread the user can no longer open', async () => {
            const db = seeded({}, mcpCreatedTask())
            const result = await askAssistant(
                USER,
                { projectId: P, taskId: TASK, message: 'Hi', waitSeconds: 0 },
                {},
                { db, enqueue: jest.fn() }
            )
            await db.doc(`items/${P}/tasks/${TASK}`).update({ isPublicFor: ['colleague'] })
            await expect(
                askAssistant(USER, { projectId: P, taskId: TASK, waitForCommentId: result.commentId }, {}, { db })
            ).rejects.toThrow(/not found/)
            expect(taskComments(db)).toHaveLength(1)
        })
    })
})
