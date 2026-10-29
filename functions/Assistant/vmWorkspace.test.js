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
        threads: [
            {
                id: 'p1__t1',
                runId: 'run1',
                projectId: 'p1',
                objectId: 't1',
                objectType: 'tasks',
                title: 'Prepare launch',
                projectName: 'Launch',
                model: 'codex',
                status: 'initiated',
                commentId: 'c1',
                createdAt: 100,
                waitingCount: 0,
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

// AT-2916: the overview counted runs while the task list counts tasks, so a thread with a queued
// follow-up — or an orphaned cancel next to its newer run — showed up as two VMs.
describe('one entry per thread (AT-2916)', () => {
    const run = (id, status, createdAt) => ({
        kind: 'vm_job',
        userId: 'u1',
        projectId: 'p1',
        objectType: 'tasks',
        objectId: 't1',
        status,
        statusCommentId: `c-${id}`,
        createdAt,
        agentModel: 'opus',
    })

    it('represents a thread by the run holding it and only counts queued follow-ups', async () => {
        const { db } = database({
            'pendingWebhooks/run1': run('run1', 'queued', 300),
            'pendingWebhooks/run2': run('run2', 'initiated', 200),
            'pendingWebhooks/run3': run('run3', 'queued', 400),
            'pendingWebhooks/ghost': run('ghost', 'cancel_requested', 100),
        })
        const { jobs, threads } = await listActiveVmJobs({ db, userId: 'u1' })
        expect(jobs).toHaveLength(4)
        expect(threads).toEqual([
            expect.objectContaining({ id: 'p1__t1', runId: 'run2', status: 'initiated', waitingCount: 2 }),
        ])
    })

    it('keeps a stop in progress visible while it is the only thing on the thread', async () => {
        const { db } = database({ 'pendingWebhooks/run1': run('run1', 'cancel_requested', 100) })
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads).toEqual([
            expect.objectContaining({ runId: 'run1', status: 'cancel_requested' }),
        ])
    })
})

describe('paused VMs on open tasks (AT-2916)', () => {
    const pausedSession = overrides => ({
        projectId: 'p1',
        objectId: 't2',
        objectType: 'tasks',
        status: 'paused',
        lastRunStatus: 'completed',
        lastRequestUserId: 'u1',
        lastRunCorrelationId: 'done-run',
        taskDone: false,
        lastUsedAt: 500,
        ...overrides,
    })
    const pausedData = (session = {}, task = {}) => ({
        'pendingWebhooks/run1': null,
        'items/p1/tasks/t2': { name: 'Polish the overview', isPublicFor: [0], ...task },
        'vmSessions/p1__t2': pausedSession(session),
        'pendingWebhooks/done-run': {
            kind: 'vm_job',
            userId: 'u1',
            projectId: 'p1',
            objectType: 'tasks',
            objectId: 't2',
            status: 'completed',
            statusCommentId: 'last-comment',
            agentModel: 'opus',
            createdAt: 50,
        },
    })

    it('lists the paused VM of an open task with the comment of its last run', async () => {
        const { db } = database(pausedData())
        expect(await listActiveVmJobs({ db, userId: 'u1' })).toEqual({
            jobs: [],
            threads: [
                {
                    id: 'p1__t2',
                    runId: 'done-run',
                    projectId: 'p1',
                    objectId: 't2',
                    objectType: 'tasks',
                    title: 'Polish the overview',
                    projectName: 'Launch',
                    model: 'opus',
                    status: 'paused',
                    commentId: 'last-comment',
                    createdAt: 500,
                    waitingCount: 0,
                },
            ],
        })
    })

    it('treats a sandbox kept alive after its run as paused, like the task list badge', async () => {
        const { db } = database(pausedData({ status: 'idle_running' }))
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads).toEqual([
            expect.objectContaining({ status: 'paused' }),
        ])
    })

    it.each([
        ['a done task (mirrored flag)', { taskDone: true }, {}],
        ['a done task (flag lagging behind)', {}, { done: true }],
        ['a session last used by someone else', { lastRequestUserId: 'other' }, {}],
        ['a session whose last run failed', { lastRunStatus: 'failed' }, {}],
        ['a session whose sandbox was discarded', { status: 'failed' }, {}],
        ['a session that is busy without a live run of this user', { status: 'busy' }, {}],
        ['an inaccessible task', {}, { isPublicFor: ['other'] }],
    ])('omits %s', async (_, session, task) => {
        const { db } = database(pausedData(session, task))
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads).toEqual([])
    })

    it('does not show a thread twice while a new run is working on its paused VM', async () => {
        const { db } = database({
            ...pausedData(),
            'pendingWebhooks/run1': {
                kind: 'vm_job',
                userId: 'u1',
                projectId: 'p1',
                objectType: 'tasks',
                objectId: 't2',
                status: 'initiated',
                statusCommentId: 'c1',
                createdAt: 600,
            },
        })
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads).toEqual([
            expect.objectContaining({ id: 'p1__t2', runId: 'run1', status: 'initiated' }),
        ])
    })

    it('shows a selected run that just finished as the paused VM it left behind', async () => {
        const { db } = database(pausedData())
        expect((await listActiveVmJobs({ db, userId: 'u1', selectedRunId: 'done-run' })).threads).toEqual([
            expect.objectContaining({ id: 'p1__t2', runId: 'done-run', status: 'paused' }),
        ])
    })

    it('keeps a selected run visible as finished once its task is done', async () => {
        const { db } = database(pausedData({ taskDone: true }, { done: true }))
        expect((await listActiveVmJobs({ db, userId: 'u1', selectedRunId: 'done-run' })).threads).toEqual([
            expect.objectContaining({ id: 'p1__t2', runId: 'done-run', status: 'completed' }),
        ])
    })

    it('lists running VMs before paused ones', async () => {
        const { db, data } = database(pausedData())
        data['pendingWebhooks/run1'] = {
            kind: 'vm_job',
            userId: 'u1',
            projectId: 'p1',
            objectType: 'tasks',
            objectId: 't1',
            status: 'initiated',
            statusCommentId: 'c1',
            createdAt: 900,
        }
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads.map(thread => thread.id)).toEqual([
            'p1__t1',
            'p1__t2',
        ])
    })

    it('still lists running VMs when the paused query is refused', async () => {
        const { db } = database()
        const collection = db.collection
        db.collection = path =>
            path === 'vmSessions'
                ? {
                      where: () => ({
                          where: () => ({ limit: () => ({ get: () => Promise.reject(new Error('index')) }) }),
                      }),
                  }
                : collection(path)
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        expect((await listActiveVmJobs({ db, userId: 'u1' })).threads).toEqual([
            expect.objectContaining({ runId: 'run1' }),
        ])
        warn.mockRestore()
    })
})
