const { getVmJobStatus } = require('./vmJobStatus')
const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')

const pending = {
    kind: 'vm_job',
    status: 'initiated',
    userId: 'u',
    projectId: 'p',
    objectType: 'tasks',
    objectId: 't',
    statusCommentId: 'c',
    privateKey: 'never-return-this',
}
let db
beforeEach(() => {
    db = new KnowledgeFirestoreDouble({
        'users/u': {},
        'projects/p': { userIds: ['u', 'teammate'] },
        'items/p/tasks/t': { isPublicFor: [0] },
        'pendingWebhooks/vm-1': pending,
        'chatComments/p/tasks/t/comments/c': { commentText: 'PDF ready', assistantRun: { runId: 'vm-1' } },
    })
    const collection = db.collection.bind(db)
    db.collection = path => Object.assign(collection(path), { doc: id => db.doc(`${path}/${id}`) })
})
const read = args => getVmJobStatus({ db, userId: 'u', correlationId: 'vm-1', ...args })

test('waits for the same job and returns attachment references without exposing credentials', async () => {
    let now = 1000
    const attachment = { artifactId: 'a', projectId: 'p', versionNumber: 1 }
    const sleep = jest.fn(async ms => {
        now += ms
        db.update('pendingWebhooks/vm-1', { status: 'completed', resultArtifacts: [attachment] })
    })
    const result = await read({ waitSeconds: 30, now: () => now, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'completed', settled: true, output: 'PDF ready', artifacts: [attachment] })
    expect(JSON.stringify(result)).not.toContain('never-return-this')
    expect(db.commits).toBe(0)
})

test('a pending job returns at the wait deadline without creating work', async () => {
    let now = 0
    const result = await read({
        waitSeconds: 3,
        now: () => now,
        sleep: async ms => {
            now += ms
        },
    })
    expect(now).toBe(3000)
    expect(result).toMatchObject({ status: 'initiated', settled: false, artifacts: [] })
    expect(db.commits).toBe(0)
})

test.each(['failed', 'cancelled', 'interrupted', 'awaiting_user'])(
    'returns %s without waiting or restarting',
    async status => {
        db.update('pendingWebhooks/vm-1', { status })
        const sleep = jest.fn()
        expect((await read({ waitSeconds: 30, sleep })).status).toBe(status)
        expect(sleep).not.toHaveBeenCalled()
    }
)

test('checks job ownership even for a shared thread', async () => {
    await expect(read({ userId: 'teammate' })).rejects.toThrow('VM job not found')
})

test('rechecks thread access during a wait', async () => {
    let now = 0
    await expect(
        read({
            waitSeconds: 30,
            now: () => now,
            sleep: async ms => {
                now += ms
                db.update('items/p/tasks/t', { isPublicFor: ['teammate'] })
            },
        })
    ).rejects.toThrow('access')
})

test.each([{ correlationId: '../private' }, { waitSeconds: 31 }, { waitSeconds: -1 }])(
    'rejects invalid status arguments %o',
    async args => {
        await expect(read(args)).rejects.toThrow()
    }
)
