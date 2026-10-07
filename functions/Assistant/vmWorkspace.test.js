const { listActiveVmJobs } = require('./vmWorkspace')

function database(overrides = {}) {
    const data = {
        'projects/p1': { name: 'Launch', userIds: ['u1'] },
        'items/p1/tasks/t1': { name: 'Prepare launch', isPublicFor: [0] },
        'pendingWebhooks/run1': {
            kind: 'vm_job',
            userId: 'u1',
            projectId: 'p1',
            objectType: 'tasks',
            objectId: 't1',
            status: 'initiated',
            statusCommentId: 'c1',
            createdAt: 100,
            agentModel: 'codex',
            sandboxId: 'private-sandbox',
            subscriptionAuth: 'secret',
        },
        ...overrides,
    }
    const snapshot = path => ({ id: path.split('/').pop(), exists: !!data[path], data: () => data[path] })
    const db = {
        doc: path => ({ path, get: async () => snapshot(path) }),
        getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
        collection: path => {
            const filters = []
            const query = {
                where: (field, op, value) => {
                    filters.push([field, op, value])
                    return query
                },
                limit: () => query,
                get: async () => ({
                    docs: Object.keys(data)
                        .filter(
                            key =>
                                key.startsWith(path + '/') &&
                                data[key] &&
                                filters.every(([field, op, value]) =>
                                    op === 'in' ? value.includes(data[key][field]) : data[key][field] === value
                                )
                        )
                        .map(snapshot),
                }),
            }
            return query
        },
    }
    return { db, data }
}

it('discovers only the requesting user’s live jobs and returns an explicit public projection', async () => {
    const { db, data } = database()
    data['pendingWebhooks/other'] = { ...data['pendingWebhooks/run1'], userId: 'other' }
    data['pendingWebhooks/old'] = { ...data['pendingWebhooks/run1'], status: 'completed' }
    expect(await listActiveVmJobs({ db, userId: 'u1' })).toEqual({
        jobs: [
            {
                id: 'run1',
                projectId: 'p1',
                objectId: 't1',
                objectType: 'tasks',
                title: 'Prepare launch',
                projectName: 'Launch',
                model: 'codex',
                status: 'initiated',
                commentId: 'c1',
                createdAt: 100,
            },
        ],
    })
})

it.each(['queued', 'pending', 'initiated', 'awaiting_user', 'cancel_requested'])('includes %s jobs', async status => {
    const { db, data } = database()
    data['pendingWebhooks/run1'].status = status
    expect((await listActiveVmJobs({ db, userId: 'u1' })).jobs).toHaveLength(1)
})

it('keeps only a selected terminal result, with ownership checked again', async () => {
    const { db, data } = database()
    data['pendingWebhooks/run1'].status = 'completed'
    expect((await listActiveVmJobs({ db, userId: 'u1' })).jobs).toEqual([])
    expect((await listActiveVmJobs({ db, userId: 'u1', selectedRunId: 'run1' })).jobs).toHaveLength(1)
    expect((await listActiveVmJobs({ db, userId: 'other', selectedRunId: 'run1' })).jobs).toEqual([])
})

it.each([
    ['projects/p1', { userIds: [] }],
    ['items/p1/tasks/t1', { name: 'Private', isPublicFor: ['other'] }],
    ['items/p1/tasks/t1', null],
])('omits work when the host is inaccessible: %s', async (path, value) => {
    const { db } = database({ [path]: value })
    expect((await listActiveVmJobs({ db, userId: 'u1', selectedRunId: 'run1' })).jobs).toEqual([])
})

it('supports daily assistant conversations without leaking another owner’s conversation', async () => {
    const { db, data } = database({
        'chatObjects/p1/chats/t1': { title: 'Daily conversation', isPublicFor: [0], annaOwnerId: 'u1' },
    })
    data['pendingWebhooks/run1'].objectType = 'topics'
    expect((await listActiveVmJobs({ db, userId: 'u1' })).jobs[0].title).toBe('Daily conversation')
    data['chatObjects/p1/chats/t1'].annaOwnerId = 'other'
    expect((await listActiveVmJobs({ db, userId: 'u1' })).jobs).toEqual([])
})
