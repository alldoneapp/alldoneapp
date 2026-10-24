const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    dispatchDueKnowledgeBaseIngests,
    enqueueKnowledgeBaseIngest,
    getKnowledgeBaseTaskId,
} = require('./knowledgeBaseDispatcher')

const NOW = 1_800_000_000_000

function createQueue() {
    const ids = new Set()
    return {
        enqueued: [],
        enqueue: jest.fn(async function (payload, options) {
            if (ids.has(options.id)) {
                const error = new Error('exists')
                error.code = 'functions/task-already-exists'
                throw error
            }
            ids.add(options.id)
            this.enqueued.push({ payload, options })
        }),
    }
}

describe('getKnowledgeBaseTaskId', () => {
    it('is a valid Cloud Tasks id that changes with the due time', () => {
        expect(getKnowledgeBaseTaskId('-M6X9vdIokG7HAammHGg', 1234)).toBe('kb--M6X9vdIokG7HAammHGg-1234')
        expect(getKnowledgeBaseTaskId('a/b.c', 1)).toBe('kb-a_b_c-1')
    })
})

describe('dispatchDueKnowledgeBaseIngests', () => {
    it('enqueues due wikis once and leaves the rest alone', async () => {
        const db = new KnowledgeFirestoreDouble({
            'knowledgeBases/due': { enabled: true, nextRunAt: NOW - 10 },
            'knowledgeBases/later': { enabled: true, nextRunAt: NOW + 60_000 },
            'knowledgeBases/off': { enabled: false, nextRunAt: null },
            'knowledgeBases/running': { enabled: true, nextRunAt: NOW - 5, leaseOwner: 'r', leaseExpiresAt: NOW + 1 },
        })
        const queue = createQueue()

        const first = await dispatchDueKnowledgeBaseIngests({ db, queue, now: NOW })
        const second = await dispatchDueKnowledgeBaseIngests({ db, queue, now: NOW })

        expect(queue.enqueued.map(entry => entry.payload.projectId)).toEqual(['due'])
        expect(queue.enqueued[0].options).toMatchObject({
            id: getKnowledgeBaseTaskId('due', NOW - 10),
            dispatchDeadlineSeconds: 1800,
        })
        expect(first).toMatchObject({ due: 2, enqueued: 1, busy: 1 })
        expect(second).toMatchObject({ enqueued: 0, duplicate: 1 })
    })

    it('marks a run requested by an invalidation as a rebuild', async () => {
        const db = new KnowledgeFirestoreDouble({
            'knowledgeBases/p': { enabled: true, nextRunAt: NOW - 1, rebuildRequestedAt: NOW - 1 },
        })
        const queue = createQueue()

        await dispatchDueKnowledgeBaseIngests({ db, queue, now: NOW })

        expect(queue.enqueued[0].payload).toEqual({ projectId: 'p', dueAt: NOW - 1, trigger: 'rebuild' })
    })

    it('keeps going past a wiki it could not enqueue', async () => {
        const db = new KnowledgeFirestoreDouble({
            'knowledgeBases/a': { enabled: true, nextRunAt: NOW - 2 },
            'knowledgeBases/b': { enabled: true, nextRunAt: NOW - 1 },
        })
        const queue = createQueue()
        queue.enqueue.mockImplementationOnce(async () => {
            throw new Error('quota')
        })
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})

        const stats = await dispatchDueKnowledgeBaseIngests({ db, queue, now: NOW })

        expect(stats).toMatchObject({ failed: 1, enqueued: 1 })
        errorLog.mockRestore()
    })
})

describe('enqueueKnowledgeBaseIngest', () => {
    it('reports a duplicate instead of failing', async () => {
        const queue = createQueue()
        await expect(enqueueKnowledgeBaseIngest({ projectId: 'p', dueAt: NOW, queue })).resolves.toBe('enqueued')
        await expect(enqueueKnowledgeBaseIngest({ projectId: 'p', dueAt: NOW, queue })).resolves.toBe('duplicate')
    })
})
