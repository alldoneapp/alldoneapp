const { getEmailIdentity } = require('./emailThreadIdentity')
const { findEmailThreadTasks, persistEmailTaskAtomically } = require('./emailThreadTaskStore')

function createDatabase(initial = {}) {
    const docs = new Map(Object.entries(initial))
    let revision = 0
    const snapshot = path => ({ exists: docs.has(path), data: () => docs.get(path) })
    const read = ref =>
        ref.query
            ? {
                  docs: [...docs.entries()]
                      .filter(
                          ([path, data]) =>
                              path.startsWith(`${ref.path}/`) &&
                              path.split('/').length === 4 &&
                              ref.field.split('.').reduce((value, key) => value?.[key], data) === ref.value
                      )
                      .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data })),
              }
            : snapshot(ref.path)
    return {
        docs,
        doc: path => ({ path, get: async () => read({ path }) }),
        collection: path => ({
            where: (field, op, value) => {
                const query = { path, field, value, query: true }
                return { ...query, get: async () => read(query) }
            },
        }),
        runTransaction: async callback => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const readRevision = revision
                const writes = []
                const result = await callback({
                    get: async ref => read(ref),
                    set: (ref, data) => writes.push([ref.path, data]),
                })
                if (revision !== readRevision) continue
                writes.forEach(([path, data]) => docs.set(path, data))
                revision++
                return result
            }
            throw new Error('Too many transaction retries')
        },
    }
}

const gmailData = { gmailEmail: 'me@example.com', threadId: 'thread-1', messageId: 'message-1' }
const task = { name: 'Existing', userId: 'user-1', isPublicFor: [0], gmailData }
const identity = getEmailIdentity('user-1', gmailData)

test('finds exact account/thread matches only inside the allowed projects and task visibility', async () => {
    const database = createDatabase({
        'items/p1/tasks/existing': task,
        'items/p2/tasks/other-project': task,
        'items/p1/tasks/other-account': { ...task, gmailData: { ...gmailData, gmailEmail: 'other@example.com' } },
        'items/p1/tasks/private': { ...task, isPublicFor: ['another-user'] },
        'items/p1/tasks/other-thread': { ...task, gmailData: { ...gmailData, threadId: 'other' } },
    })
    expect(await findEmailThreadTasks({ database, identity, projectIds: ['p1'] })).toEqual([
        { taskId: 'existing', projectId: 'p1', task },
    ])
})

test('racing messages create exactly one task and retry against the winning thread registration', async () => {
    const database = createDatabase()
    const params = { database, userId: 'user-1', projectIds: ['p1'], selectMatch: matches => matches[0] }
    const results = await Promise.all(
        ['message-1', 'message-2'].map(messageId =>
            persistEmailTaskAtomically({
                ...params,
                taskResult: {
                    taskId: messageId,
                    projectId: 'p1',
                    task: { ...task, gmailData: { ...gmailData, messageId } },
                },
            })
        )
    )
    expect(results[0].taskId).toBe(results[1].taskId)
    expect(results.map(result => result.existing).sort()).toEqual([false, true])
    expect([...database.docs.keys()].filter(path => path.startsWith('items/'))).toHaveLength(1)
})

test('adopts a legacy task and recovers when its registered task was deleted', async () => {
    const database = createDatabase({ 'items/p1/tasks/legacy': task })
    const params = {
        database,
        userId: 'user-1',
        projectIds: ['p1'],
        selectMatch: matches => matches[0],
        taskResult: { taskId: 'new', projectId: 'p1', task },
    }
    expect((await persistEmailTaskAtomically(params)).taskId).toBe('legacy')
    expect(database.docs.has('items/p1/tasks/new')).toBe(false)
    database.docs.delete('items/p1/tasks/legacy')
    expect(await persistEmailTaskAtomically(params)).toEqual(
        expect.objectContaining({ taskId: 'new', existing: false })
    )
})

test('does not overwrite existing task fields, origin, approval or completion data', async () => {
    const original = { ...task, suggestedBy: 'assistant-1', inDone: true, description: 'Manual edit', dueDate: 123 }
    const database = createDatabase({ 'items/p1/tasks/existing': original })
    await persistEmailTaskAtomically({
        database,
        userId: 'user-1',
        projectIds: ['p1'],
        selectMatch: matches => matches[0],
        taskResult: { taskId: 'new', projectId: 'p1', task: { ...task, name: 'Different title' } },
    })
    expect(database.docs.get('items/p1/tasks/existing')).toEqual(original)
})

test('refuses creation outside the supplied project scope', async () => {
    const database = createDatabase()
    await expect(
        persistEmailTaskAtomically({
            database,
            userId: 'user-1',
            projectIds: ['p1'],
            taskResult: { taskId: 'new', projectId: 'inaccessible', task },
        })
    ).rejects.toThrow('outside the allowed')
    expect(database.docs.size).toBe(0)
})
