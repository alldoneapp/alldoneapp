const { TaskService } = require('./TaskService')
const { createEmailDatabase } = require('../Email/__fixtures__/emailDatabase')
const { resolveEmailThreadTask } = require('../Email/emailThreadTaskStore')
const { getEmailIdentity } = require('../Email/emailThreadIdentity')

const gmailData = {
    gmailEmail: 'me@example.com',
    provider: 'google',
    accountUserId: 'u',
    threadId: 'thread',
    messageId: 'first',
}
let nextId = 0
function service(database) {
    return new TaskService({ database, enableFeeds: false, enableValidation: false, idGenerator: () => `t${++nextId}` })
}
const params = {
    name: 'Send offer',
    userId: 'u',
    projectId: 'original',
    gmailData,
    creatorId: 'assistant',
    suggestedBy: 'assistant',
    taskMetadata: { assistantSuggestion: { assistantId: 'assistant' } },
}
const options = { emailThread: { userId: 'u', projectIds: ['original', 'another'] } }

test('real TaskService serializes first task creation across projects and stores content baseline', async () => {
    const database = createEmailDatabase()
    const taskService = service(database)
    const results = await Promise.all([
        taskService.createAndPersistTask(params, {}, options),
        taskService.createAndPersistTask(
            { ...params, projectId: 'another', gmailData: { ...gmailData, messageId: 'second' } },
            {},
            options
        ),
    ])
    expect(results[0].taskId).toBe(results[1].taskId)
    expect(results.map(result => result.existing).sort()).toEqual([false, true])
    expect([...database.docs.keys()].filter(path => path.startsWith('items/'))).toHaveLength(1)
    const task = results.find(result => !result.existing).task
    expect(task.gmailData.taskContent).toMatchObject({ name: 'Send offer', description: '', priority: 'none' })
    expect(task.suggestedBy).toBe('assistant')
    expect(task.creatorId).toBe('assistant')
})

test('ambiguous legacy matches create one separate task even when duplicate requests race', async () => {
    const legacy = { ...params, isPublicFor: [0], gmailData: { ...gmailData, messageId: 'older' } }
    const database = createEmailDatabase({ 'items/original/tasks/a': legacy, 'items/another/tasks/b': legacy })
    const taskService = service(database)
    const results = await Promise.all([
        taskService.createAndPersistTask(params, {}, options),
        taskService.createAndPersistTask(params, {}, options),
    ])
    expect(results[0].taskId).toBe(results[1].taskId)
    expect(results[0].taskId).not.toBe('a')
    expect([...database.docs.keys()].filter(path => path.startsWith('items/'))).toHaveLength(3)
    expect(database.docs.get('items/original/tasks/a')).toBe(legacy)
    const selected = await resolveEmailThreadTask({
        database,
        identity: getEmailIdentity('u', gmailData),
        projectIds: options.emailThread.projectIds,
    })
    expect(selected.taskId).toBe(results[0].taskId)
    // A later, different email still has several plausible matches.
    expect(
        await resolveEmailThreadTask({
            database,
            identity: getEmailIdentity('u', { ...gmailData, messageId: 'later' }),
            projectIds: options.emailThread.projectIds,
        })
    ).toBeNull()
})

test('adoption keeps original project and never runs the ordinary task write/feed path', async () => {
    const original = { ...params, isPublicFor: [0], description: 'User edit', inDone: true }
    const database = createEmailDatabase({ 'items/original/tasks/existing': original })
    const taskService = service(database)
    const persist = jest.spyOn(taskService, 'persistTask')
    const result = await taskService.createAndPersistTask(
        { ...params, name: 'Replacement', projectId: 'another' },
        {},
        options
    )
    expect(result).toMatchObject({ taskId: 'existing', projectId: 'original', existing: true, success: true })
    expect(persist).not.toHaveBeenCalled()
    expect(database.docs.get('items/original/tasks/existing')).toBe(original)
})

test('a user edit after the atomic task commit cannot be overwritten by feed persistence', async () => {
    const database = createEmailDatabase()
    const taskService = service(database)
    const persist = taskService.persistTask.bind(taskService)
    taskService.persistTask = async (result, opts) => {
        const path = `items/original/tasks/${result.taskId}`
        database.docs.set(path, { ...database.docs.get(path), description: 'Concurrent user edit' })
        return persist(result, opts)
    }
    const result = await taskService.createAndPersistTask(params, {}, options)
    expect(database.docs.get(`items/original/tasks/${result.taskId}`).description).toBe('Concurrent user edit')
})
