jest.mock('./emailLine/taskSummarizer', () => ({ summarizeEmailContinuation: jest.fn() }))
jest.mock('../Assistant/assistantHelper', () => ({ calculateGoldCostFromTokens: jest.fn(() => 3) }))
jest.mock('../Gold/goldHelper', () => ({ deductGold: jest.fn(async () => ({ success: true })) }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => 'unused' }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ FEED_PUBLIC_FOR_ALL: 0, STAYWARD_COMMENT: 2 }))

const { continueEmailThread } = require('./emailThreadContinuation')
const { summarizeEmailContinuation } = require('./emailLine/taskSummarizer')
const { deductGold } = require('../Gold/goldHelper')
const { TaskCommentService } = require('../shared/TaskCommentService')
const { createEmailDatabase } = require('./__fixtures__/emailDatabase')

const gmailData = {
    provider: 'google',
    accountUserId: 'u',
    gmailEmail: 'me@example.com',
    messageId: 'first',
    threadId: 'thread',
}
const initialTask = {
    name: 'Send offer',
    extendedName: 'Send offer',
    description: 'Keep the contract attachment',
    userId: 'u',
    creatorId: 'assistant',
    isPublicFor: [0],
    dueDate: 100,
    priority: 'none',
    suggestedBy: 'assistant',
    taskMetadata: { assistantSuggestion: { assistantId: 'assistant' } },
    executionMode: 'workflow',
    inDone: true,
    done: true,
    currentReviewerId: 'Done',
    completed: 123,
    gmailData: {
        ...gmailData,
        taskContent: {
            name: 'Send offer',
            description: 'Keep the contract attachment',
            dueDate: 100,
            priority: 'none',
        },
    },
}
let database
let args
beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(TaskCommentService.prototype, 'notifyFollowers').mockResolvedValue()
    database = createEmailDatabase({ 'items/original/tasks/t1': initialTask })
    args = {
        database,
        userId: 'u',
        userData: { projectIds: ['original', 'new-project'], language: 'de' },
        gmailData: { ...gmailData, messageId: 'second', selectedProjectId: 'new-project' },
        context: {
            from: 'Client',
            subject: 'Offer update',
            date: '2026-10-07T10:00:00Z',
            bodyText: 'Full email, not the comment',
        },
        actor: { uid: 'u' },
    }
    summarizeEmailContinuation.mockResolvedValue({
        totalTokens: 120,
        modelKey: 'MODEL_GPT5_4_NANO',
        plan: {
            summary: 'Client requests a revised offer for Friday.',
            actionUpdate: 'Revise the offer with the new scope by Friday.',
            name: 'Revise offer',
            dueDate: 200,
            priority: 'must_do',
        },
    })
})
afterEach(() => jest.restoreAllMocks())

test('updates actionable content, reopens, keeps original project and preserves suggestion approval', async () => {
    const result = await continueEmailThread(args)
    expect(result).toMatchObject({ taskId: 't1', projectId: 'original', updated: true, goldCost: 3 })
    const task = database.docs.get('items/original/tasks/t1')
    expect(task).toMatchObject({
        name: 'Revise offer',
        extendedName: 'Revise offer',
        dueDate: 200,
        priority: 'must_do',
        done: false,
        inDone: false,
        completed: null,
        currentReviewerId: 'u',
        suggestedBy: 'assistant',
        creatorId: 'assistant',
        taskMetadata: initialTask.taskMetadata,
        executionMode: 'workflow',
    })
    expect(task.description).toBe('Keep the contract attachment\n\nRevise the offer with the new scope by Friday.')
    expect(task.gmailData.messageIds).toEqual(['first', 'second'])
    const comment = database.docs.get(`chatComments/original/tasks/t1/comments/${result.commentId}`)
    expect(comment.commentText).toContain('Client requests a revised offer for Friday.')
    expect(comment.commentText).not.toContain(args.context.bodyText)
    expect(comment.gmailData).toMatchObject({ messageId: 'second', taskProjectId: 'original', accountUserId: 'u' })
})

test('user edits and unrelated fields survive; legacy tasks get additive actionable content', async () => {
    for (const legacy of [false, true]) {
        database = createEmailDatabase({
            'items/original/tasks/t1': {
                ...initialTask,
                name: 'My title',
                extendedName: 'My title',
                dueDate: 777,
                priority: 'could_do',
                description: 'My notes',
                userIds: ['u', 'colleague'],
                gmailData: legacy ? gmailData : initialTask.gmailData,
            },
        })
        await continueEmailThread({ ...args, database })
        const task = database.docs.get('items/original/tasks/t1')
        expect(task).toMatchObject({
            name: 'My title',
            dueDate: 777,
            priority: 'could_do',
            userIds: ['u', 'colleague'],
        })
        expect(task.description).toBe('My notes\n\nRevise the offer with the new scope by Friday.')
    }
})

test('informational email gets a summary and reopens without speculative content edits', async () => {
    summarizeEmailContinuation.mockResolvedValue({
        totalTokens: 1,
        modelKey: 'MODEL_GPT5_4_NANO',
        plan: { summary: 'Client confirms receipt.' },
    })
    await continueEmailThread(args)
    expect(database.docs.get('items/original/tasks/t1')).toMatchObject({
        name: initialTask.name,
        description: initialTask.description,
        priority: 'none',
        dueDate: 100,
        inDone: false,
    })
})

test('automated summaries use the assistant author and notify the task owner', async () => {
    const actor = jest.fn(async () => ({ uid: 'assistant', displayName: 'Anna', fromAssistant: true }))
    const result = await continueEmailThread({ ...args, actor })
    expect(database.docs.get(`chatComments/original/tasks/t1/comments/${result.commentId}`)).toMatchObject({
        creatorId: 'assistant',
        fromAssistant: true,
        gmailData: { origin: 'gmail_label_follow_up' },
    })
    expect(TaskCommentService.prototype.notifyFollowers).toHaveBeenCalledWith(
        expect.objectContaining({ followers: ['u'] })
    )
    await continueEmailThread({ ...args, actor })
    expect(actor).toHaveBeenCalledTimes(1)
})

test('sequential and concurrent duplicate processing writes one comment, update and charge', async () => {
    const results = await Promise.all([continueEmailThread(args), continueEmailThread(args)])
    expect(results.filter(result => result.updated)).toHaveLength(1)
    const repeated = await continueEmailThread(args)
    expect(repeated.goldCost).toBe(0)
    expect(summarizeEmailContinuation).toHaveBeenCalledTimes(2)
    expect(deductGold).toHaveBeenCalledTimes(1)
    expect(database.docs.get('items/original/tasks/t1').commentsData.amount).toBe(1)
    expect([...database.docs.keys()].filter(path => path.startsWith('chatComments/'))).toHaveLength(1)
})

test('concurrent different messages preserve both updates and do not overwrite each other’s title', async () => {
    await Promise.all([
        continueEmailThread(args),
        continueEmailThread({ ...args, gmailData: { ...args.gmailData, messageId: 'third' } }),
    ])
    const task = database.docs.get('items/original/tasks/t1')
    expect(task.commentsData.amount).toBe(2)
    expect(task.gmailData.messageIds.sort()).toEqual(['first', 'second', 'third'])
    expect(task.description.match(/Revise the offer/g)).toHaveLength(2)
    expect(deductGold).toHaveBeenCalledTimes(2)
})

test('multiple plausible matches fall through to separate creation without mutating either', async () => {
    database.docs.set('items/new-project/tasks/t2', initialTask)
    expect(await continueEmailThread(args)).toEqual({ ambiguous: true })
    expect(summarizeEmailContinuation).not.toHaveBeenCalled()
    expect(database.docs.get('items/original/tasks/t1')).toBe(initialTask)
})

test.each([{ gmailEmail: 'different@example.com' }, { accountUserId: 'someone-else' }, { provider: 'microsoft' }])(
    'isolates another account/provider/owner: %j',
    async changed => {
        database.docs.set('items/original/tasks/t1', {
            ...initialTask,
            gmailData: { ...initialTask.gmailData, ...changed },
        })
        expect(await continueEmailThread(args)).toBeNull()
        expect(summarizeEmailContinuation).not.toHaveBeenCalled()
    }
)

test('ignores unreadable tasks and tasks outside accessible projects', async () => {
    database.docs.set('items/original/tasks/t1', { ...initialTask, isPublicFor: ['other-user'] })
    database.docs.set('items/forbidden/tasks/t2', initialTask)
    expect(await continueEmailThread(args)).toBeNull()
})

test('an older email cannot revert newer title/deadline/priority', async () => {
    database.docs.set('items/original/tasks/t1', {
        ...initialTask,
        gmailData: { ...initialTask.gmailData, lastEmailReceivedAt: Date.parse('2026-10-08T10:00:00Z') },
    })
    await continueEmailThread(args)
    expect(database.docs.get('items/original/tasks/t1')).toMatchObject({
        name: initialTask.name,
        dueDate: 100,
        priority: 'none',
    })
})

test('an undated email cannot revert fields after a dated continuation', async () => {
    database.docs.set('items/original/tasks/t1', {
        ...initialTask,
        gmailData: { ...initialTask.gmailData, lastEmailReceivedAt: 123 },
    })
    await continueEmailThread({ ...args, context: { ...args.context, date: '' } })
    expect(database.docs.get('items/original/tasks/t1')).toMatchObject({
        name: initialTask.name,
        dueDate: 100,
        priority: 'none',
    })
})

test('edits made during the model call survive transaction-time application', async () => {
    summarizeEmailContinuation.mockImplementationOnce(async () => {
        database.docs.set('items/original/tasks/t1', {
            ...initialTask,
            name: 'User edit during model call',
            extendedName: 'User edit during model call',
            description: 'Fresh user notes',
            dueDate: 900,
        })
        return {
            totalTokens: 120,
            modelKey: 'MODEL_GPT5_4_NANO',
            plan: { summary: 'An update', name: 'Overwrite', dueDate: 800, actionUpdate: 'Add the annex' },
        }
    })
    await continueEmailThread(args)
    expect(database.docs.get('items/original/tasks/t1')).toMatchObject({
        name: 'User edit during model call',
        dueDate: 900,
        description: 'Fresh user notes\n\nAdd the annex',
    })
})

test('rejected assistant suggestion remains rejected and cannot execute through reopening', async () => {
    database.docs.set('items/original/tasks/t1', { ...initialTask, userId: 'assistant', assistantId: 'assistant' })
    await continueEmailThread(args)
    expect(database.docs.get('items/original/tasks/t1')).toMatchObject({
        inDone: true,
        done: true,
        suggestedBy: 'assistant',
        completed: 123,
    })
})

test('selection becoming ambiguous during summarization aborts without writing a comment or charging', async () => {
    summarizeEmailContinuation.mockImplementation(async () => {
        database.docs.set('items/new-project/tasks/t2', initialTask)
        return { totalTokens: 120, plan: { summary: 'A summary' } }
    })
    await expect(continueEmailThread(args)).rejects.toThrow('selection changed')
    expect(deductGold).not.toHaveBeenCalled()
    expect([...database.docs.keys()].filter(path => path.startsWith('chatComments/'))).toHaveLength(0)
})

test('model failure leaves task unchanged and allows retry', async () => {
    summarizeEmailContinuation.mockRejectedValueOnce(new Error('Unavailable'))
    await expect(continueEmailThread(args)).rejects.toThrow('Unavailable')
    expect(database.docs.get('items/original/tasks/t1')).toBe(initialTask)
    expect((await continueEmailThread(args)).updated).toBe(true)
})

describe('mail the owner sent', () => {
    test('is a silent comment by the owner that never reopens or rewrites the task', async () => {
        const notify = TaskCommentService.prototype.notifyFollowers
        const result = await continueEmailThread({
            ...args,
            userData: { ...args.userData, displayName: 'Owner' },
            context: { ...args.context, snippet: 'Sounds good, I will send it Friday', internalDate: 400 },
            sentByOwner: true,
        })
        expect(result).toMatchObject({ taskId: 't1', projectId: 'original', sentByOwner: true, goldCost: 0 })
        expect(summarizeEmailContinuation).not.toHaveBeenCalled()
        expect(deductGold).not.toHaveBeenCalled()
        expect(notify).not.toHaveBeenCalled()
        const task = database.docs.get('items/original/tasks/t1')
        expect(task).toMatchObject({
            name: initialTask.name,
            description: initialTask.description,
            done: true,
            inDone: true,
            completed: 123,
        })
        expect(task.gmailData.messageIds).toBeUndefined()
        const comment = database.docs.get(`chatComments/original/tasks/t1/comments/${result.commentId}`)
        expect(comment).toMatchObject({
            commentText: 'Sounds good, I will send it Friday',
            creatorId: 'u',
            fromAssistant: false,
            gmailData: { messageId: 'second', direction: 'outgoing' },
        })
        const again = await continueEmailThread({ ...args, context: { snippet: 'x' }, sentByOwner: true })
        expect(again.updated).toBe(false)
    })
})

// AT-3022: the chat of a task created from an email started with the second email of the thread.
describe('the email a task was created from', () => {
    const { appendOriginEmailToTask } = require('./emailThreadContinuation')
    const { getEmailIdentity } = require('./emailThreadIdentity')
    const firstCommentPath = () =>
        `chatComments/original/tasks/t1/comments/email_${getEmailIdentity('u', gmailData).messageKey}`
    const originArgs = () => ({
        database,
        userId: 'u',
        projectId: 'original',
        taskId: 't1',
        gmailData: { ...gmailData, origin: 'gmail_label_follow_up' },
        context: {
            from: '"Ronny Klann" <ronny@example.com>',
            date: 'Thu, 12 Nov 2026 07:08:36 +0000',
            internalDate: '1794467316000',
            subject: 'Wohnungsübergabe',
            snippet: 'Hallo Herr Wysk, wir schlagen den 1.12. um 15:00 Uhr vor &amp; bitten um Rückmeldung.',
            bodyText: 'Full email body that must not be stored',
        },
        actor: { uid: 'assistant', displayName: 'Anna', fromAssistant: true },
    })

    test('opens the task chat at its received time, silently, without a model or Gold', async () => {
        const result = await appendOriginEmailToTask(originArgs())
        expect(result).toEqual({ commentId: `email_${getEmailIdentity('u', gmailData).messageKey}`, existing: false })
        const comment = database.docs.get(firstCommentPath())
        expect(comment).toMatchObject({
            commentText:
                '"Ronny Klann" <ronny@example.com> (Thu, 12 Nov 2026 07:08:36 +0000): Hallo Herr Wysk, wir schlagen den 1.12. um 15:00 Uhr vor & bitten um Rückmeldung.',
            creatorId: 'assistant',
            fromAssistant: true,
            created: 1794467316000,
            gmailData: {
                messageId: 'first',
                threadId: 'thread',
                accountUserId: 'u',
                taskProjectId: 'original',
                receivedAt: 1794467316000,
            },
        })
        expect(comment.commentText).not.toContain('Full email body')
        expect(comment.gmailData.direction).toBeUndefined()
        expect(summarizeEmailContinuation).not.toHaveBeenCalled()
        expect(deductGold).not.toHaveBeenCalled()
        expect(TaskCommentService.prototype.notifyFollowers).not.toHaveBeenCalled()
        // The task already lists the email; nothing about the task itself changes.
        const task = database.docs.get('items/original/tasks/t1')
        expect(task).toMatchObject({ name: initialTask.name, description: initialTask.description, done: true })
        expect(task.gmailData.messageIds).toBeUndefined()
    })

    test('the chat then holds the first and the second email, in order, each once', async () => {
        await appendOriginEmailToTask(originArgs())
        await appendOriginEmailToTask(originArgs())
        // Thread continuation for the creating email itself stays a no-op.
        expect(await continueEmailThread({ ...args, gmailData })).toMatchObject({ taskId: 't1', existing: true })
        const second = await continueEmailThread({ ...args, context: { ...args.context, internalDate: 1794470113000 } })
        const comments = [...database.docs.entries()]
            .filter(([path]) => path.startsWith('chatComments/original/tasks/t1/comments/'))
            .map(([, data]) => data)
            .sort((a, b) => a.created - b.created)
        expect(comments.map(comment => comment.gmailData.messageId)).toEqual(['first', 'second'])
        expect(database.docs.get(`chatComments/original/tasks/t1/comments/${second.commentId}`)).toBeTruthy()
    })

    test('mail the owner sent is the owner’s message', async () => {
        await appendOriginEmailToTask({
            ...originArgs(),
            actor: { uid: 'u', displayName: 'Owner', fromAssistant: false },
            context: { snippet: 'Können wir das am 28.11. machen?', internalDate: 500 },
            outgoing: true,
        })
        expect(database.docs.get(firstCommentPath())).toMatchObject({
            commentText: 'Können wir das am 28.11. machen?',
            creatorId: 'u',
            fromAssistant: false,
            created: 500,
            gmailData: { direction: 'outgoing', archiveOnComplete: false },
        })
    })

    test('an undated email is placed now, and falls back to the subject without a snippet', async () => {
        const before = Date.now()
        await appendOriginEmailToTask({ ...originArgs(), context: { from: 'Client', subject: 'Offer' } })
        const comment = database.docs.get(firstCommentPath())
        expect(comment.commentText).toBe('Client: Offer')
        expect(comment.created).toBeGreaterThanOrEqual(before)
    })

    test('refuses an email of another thread or account', async () => {
        await expect(
            appendOriginEmailToTask({ ...originArgs(), gmailData: { ...gmailData, threadId: 'other-thread' } })
        ).rejects.toThrow('does not match')
        expect(await appendOriginEmailToTask({ ...originArgs(), gmailData: { provider: 'google' } })).toBeNull()
        expect([...database.docs.keys()].filter(path => path.startsWith('chatComments/'))).toHaveLength(0)
    })
})
