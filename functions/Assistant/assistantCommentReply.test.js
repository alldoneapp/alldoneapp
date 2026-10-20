jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }))

const { getObjectDocPath } = require('../shared/privacyAccess')
const { buildAssistantRunLockId, AssistantRunCancelledError } = require('./assistantRunIdempotency')
const { isReplyCandidate, enqueueAssistantCommentReply, runAssistantCommentReply } = require('./assistantCommentReply')

const params = { projectId: 'project', objectType: 'tasks', objectId: 'object', commentId: 'comment' }
const object = { isAssistantEnabled: true, assistantId: 'target', userId: 'human', isPublicFor: [0] }
const comment = { fromAssistant: true, creatorId: 'author', commentText: 'Please review', requestUserId: 'human' }
const workerParams = { ...params, assistantId: 'target' }
const commentPath = p => `chatComments/${p.projectId}/${p.objectType}/${p.objectId}/comments/${p.commentId}`

// Serialize transactions as Firestore does when two workers claim the same message.
function createDb(p = params, objectData = object, commentData = comment) {
    const docs = new Map([
        [getObjectDocPath(p.projectId, p.objectType, p.objectId), { ...objectData }],
        [commentPath(p), { ...commentData }],
        ['projects/project', { userIds: ['human', 'follower', 'outsider'] }],
        ['users/human', { language: 'de' }],
        [`followers/project/${p.objectType}/object`, { usersFollowing: ['follower', 'removed-user'] }],
    ])
    let tail = Promise.resolve()
    const write = (ref, data, options) => docs.set(ref.path, options?.merge ? { ...docs.get(ref.path), ...data } : data)
    const snapshot = ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) })
    const db = {
        docs,
        doc: path => ({
            path,
            firestore: db,
            get: async () => snapshot({ path }),
            set: async (data, options) => write({ path }, data, options),
        }),
        runTransaction: callback => {
            const result = tail.then(() => callback({ get: async ref => snapshot(ref), set: write }))
            tail = result.catch(() => {})
            return result
        },
    }
    return db
}

function lockData(db) {
    return db.docs.get(`assistantRunLocks/${buildAssistantRunLockId({ ...params, messageId: params.commentId })}`)
}

describe('automatic replies to assistant comments', () => {
    test.each(['tasks', 'topics', 'notes', 'goals', 'contacts', 'users', 'skills', 'assistants'])(
        'dispatches for enabled %s objects and uses their configured assistant',
        async objectType => {
            const p = { ...params, objectType }
            const db = createDb(p)
            const queue = { enqueue: jest.fn().mockResolvedValue() }
            await expect(enqueueAssistantCommentReply(p, { db, queue })).resolves.toEqual({ enqueued: true })
            expect(queue.enqueue).toHaveBeenCalledWith(
                { ...p, assistantId: objectType === 'assistants' ? 'object' : 'target' },
                { id: expect.stringMatching(/^comment-[a-f0-9]{64}$/), dispatchDeadlineSeconds: 1800 }
            )
        }
    )

    test.each(['tasks', 'topics', 'notes', 'goals', 'contacts', 'users', 'skills', 'assistants'])(
        'does not dispatch for disabled %s objects',
        async objectType => {
            const p = { ...params, objectType }
            const db = createDb(p, { ...object, isAssistantEnabled: false })
            const queue = { enqueue: jest.fn() }
            expect(await enqueueAssistantCommentReply(p, { db, queue })).toEqual({ skipped: true })
            expect(queue.enqueue).not.toHaveBeenCalled()
        }
    )

    test.each([
        ['human comment', { fromAssistant: false }],
        ['empty text', { commentText: '  ' }],
        ['own comment', { creatorId: 'target' }],
        ['normal answer / VM output', { assistantRun: { kind: 'chat' } }],
        ['tool output of automatic reply', { suppressAssistantReply: true }],
        ['unknown requesting account', { requestUserId: 'missing' }],
    ])('does not reply to %s', async (_, change) => {
        const db = createDb(params, object, { ...comment, ...change })
        const queue = { enqueue: jest.fn() }
        expect(await enqueueAssistantCommentReply(params, { db, queue })).toEqual({ skipped: true })
        expect(queue.enqueue).not.toHaveBeenCalled()
    })

    test.each([
        { isAssistantEnabled: undefined },
        { assistantId: '' },
        { isPublicFor: ['someone-else'] },
        { taskMetadata: { isWebhookTask: true } },
    ])('respects missing configuration, privacy and webhook tasks: %j', async change => {
        const db = createDb(params, { ...object, ...change })
        expect(await enqueueAssistantCommentReply(params, { db, queue: { enqueue: jest.fn() } })).toEqual({
            skipped: true,
        })
    })

    test('uses the object owner for legacy comments and never bills a non-member', async () => {
        const db = createDb(params, object, { ...comment, requestUserId: null })
        const askToBot = jest.fn()
        expect(await runAssistantCommentReply(workerParams, { db, askToBot })).toEqual({ completed: true })
        db.docs.set('projects/project', { userIds: [] })
        expect(await runAssistantCommentReply(workerParams, { db, askToBot })).toEqual({ skipped: true })
        expect(askToBot).toHaveBeenCalledTimes(1)
    })

    test('deduplicates trigger enqueue attempts and propagates real queue failures', async () => {
        const db = createDb()
        const queue = { enqueue: jest.fn().mockResolvedValueOnce().mockRejectedValueOnce({ code: 6 }) }
        await enqueueAssistantCommentReply(params, { db, queue })
        expect(await enqueueAssistantCommentReply(params, { db, queue })).toEqual({ duplicate: true })
        expect(queue.enqueue.mock.calls[0]).toEqual(queue.enqueue.mock.calls[1])
        queue.enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
        await expect(enqueueAssistantCommentReply(params, { db, queue })).rejects.toThrow('queue unavailable')
    })

    test.each(['disabled', 'changed assistant', 'deleted object', 'deleted comment', 'access revoked'])(
        'rechecks the target before execution: %s',
        async change => {
            const db = createDb()
            await enqueueAssistantCommentReply(params, { db, queue: { enqueue: jest.fn() } })
            const path = getObjectDocPath('project', 'tasks', 'object')
            if (change === 'disabled') db.docs.set(path, { ...object, isAssistantEnabled: false })
            if (change === 'changed assistant') db.docs.set(path, { ...object, assistantId: 'another-target' })
            if (change === 'deleted object') db.docs.delete(path)
            if (change === 'deleted comment') db.docs.delete(commentPath(params))
            if (change === 'access revoked') db.docs.set(path, { ...object, isPublicFor: ['outsider'] })
            const askToBot = jest.fn()
            expect(await runAssistantCommentReply(workerParams, { db, askToBot })).toEqual({ skipped: true })
            expect(askToBot).not.toHaveBeenCalled()
        }
    )

    test('runs the existing reply pipeline once for concurrent deliveries and completed redelivery', async () => {
        const db = createDb()
        const askToBot = jest.fn()
        const results = await Promise.all([
            runAssistantCommentReply(workerParams, { db, askToBot }),
            runAssistantCommentReply(workerParams, { db, askToBot }),
        ])
        expect(results).toContainEqual({ completed: true })
        expect(results).toContainEqual({ duplicate: true })
        expect(await runAssistantCommentReply(workerParams, { db, askToBot })).toEqual({ duplicate: true })
        expect(askToBot).toHaveBeenCalledTimes(1)
        expect(askToBot).toHaveBeenCalledWith(
            'human',
            'comment',
            'project',
            'tasks',
            'object',
            ['follower', 'human'],
            [0],
            'de',
            'target',
            ['follower'],
            expect.any(Number),
            expect.any(String),
            { automaticCommentReply: true, maxRunWallClockMs: 25 * 60 * 1000 }
        )
        expect(lockData(db).status).toBe('completed')
    })

    test.each(['failed', 'cancelled'])('settles %s runs without restarting on redelivery', async status => {
        const db = createDb()
        const error = status === 'cancelled' ? new AssistantRunCancelledError() : new Error('provider unavailable')
        const askToBot = jest.fn().mockRejectedValue(error)
        const run = runAssistantCommentReply(workerParams, { db, askToBot })
        if (status === 'failed') await expect(run).rejects.toThrow('provider unavailable')
        else expect(await run).toEqual({ cancelled: true })
        expect(lockData(db).status).toBe(status)
        expect(await runAssistantCommentReply(workerParams, { db, askToBot })).toEqual({ duplicate: true })
        expect(askToBot).toHaveBeenCalledTimes(1)
    })

    test('private replies notify only current followers who can read the target', async () => {
        const db = createDb(params, { ...object, isPublicFor: ['human'] })
        const askToBot = jest.fn()
        await runAssistantCommentReply(workerParams, { db, askToBot })
        expect(askToBot.mock.calls[0][5]).toEqual(['human'])
        expect(askToBot.mock.calls[0][9]).toEqual([])
    })

    test('rejects unsupported object types without any read', async () => {
        const db = { doc: jest.fn() }
        expect(await enqueueAssistantCommentReply({ ...params, objectType: 'unknown' }, { db })).toEqual({
            skipped: true,
        })
        expect(db.doc).not.toHaveBeenCalled()
        expect(isReplyCandidate({ ...comment, assistantRun: { kind: 'vm_job' } })).toBe(false)
    })
})
