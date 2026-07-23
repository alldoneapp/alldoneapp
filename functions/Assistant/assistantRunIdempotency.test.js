const {
    ASSISTANT_RUN_LOCK_LEASE_MS,
    ASSISTANT_RUN_STUCK_THRESHOLD_MS,
    acquireAssistantRunLock,
    acquireAssistantTaskRunLock,
    buildAssistantRunLockId,
    cancelAssistantRunLock,
    completeAssistantRunLock,
    failAssistantRunLock,
    requestCancelAssistantRunLock,
    shouldSkipExistingRun,
} = require('./assistantRunIdempotency')

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function createFakeDb(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs).map(([path, data]) => [path, clone(data)]))

    function snapshot(path) {
        return {
            exists: docs.has(path),
            data: () => clone(docs.get(path) || {}),
        }
    }

    function applyWrite(path, data, options = {}) {
        const previous = docs.get(path) || {}
        docs.set(path, options.merge ? { ...previous, ...clone(data) } : clone(data))
    }

    const db = {
        doc,
        docs,
        runTransaction: jest.fn(async callback => {
            const transaction = {
                get: jest.fn(async ref => snapshot(ref.path)),
                set: jest.fn((ref, data, options) => applyWrite(ref.path, data, options)),
            }
            return callback(transaction)
        }),
    }

    function doc(path) {
        return {
            path,
            firestore: db,
            set: jest.fn(async (data, options) => applyWrite(path, data, options)),
            update: jest.fn(async data => applyWrite(path, data, { merge: true })),
            get: jest.fn(async () => snapshot(path)),
        }
    }

    return db
}

const baseParams = {
    projectId: 'project-1',
    objectType: 'tasks',
    objectId: 'task-1',
    messageId: 'message-1',
    userId: 'user-1',
    assistantId: 'assistant-1',
}

describe('assistant run idempotency', () => {
    test('keeps locks alive beyond the 55-minute interactive assistant limit', () => {
        expect(ASSISTANT_RUN_LOCK_LEASE_MS).toBe(65 * 60 * 1000)
        expect(ASSISTANT_RUN_STUCK_THRESHOLD_MS).toBe(61 * 60 * 1000)
    })

    test('builds a deterministic Firestore-safe lock id', () => {
        expect(
            buildAssistantRunLockId({
                projectId: 'project/1',
                objectType: 'tasks',
                objectId: 'task 1',
                messageId: 'message/1',
            })
        ).toBe('project_1__tasks__task_1__message_1')
    })

    test('acquires and stores a running lock for a new message', async () => {
        const db = createFakeDb()

        const result = await acquireAssistantRunLock(db, baseParams, () => 1000)

        expect(result.acquired).toBe(true)
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            messageId: 'message-1',
            userId: 'user-1',
            assistantId: 'assistant-1',
            status: 'running',
            lockExpiresAt: 1000 + ASSISTANT_RUN_LOCK_LEASE_MS,
        })
        expect(db.docs.get('assistantTaskRunLocks/project-1__tasks__task-1')).toMatchObject({
            ownerId: 'project-1__tasks__task-1__message-1',
            kind: 'chat',
            status: 'running',
        })
    })

    test('prevents a workflow prompt from claiming a task while a comment run is active', async () => {
        const db = createFakeDb()
        await acquireAssistantRunLock(db, baseParams, () => 1000)

        const workflowLock = await acquireAssistantTaskRunLock(
            db,
            {
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                ownerId: 'workflow-run-1',
                kind: 'workflow',
            },
            () => 2000
        )

        expect(workflowLock.acquired).toBe(false)
        expect(workflowLock.reason).toBe('already_running')
        expect(workflowLock.existing).toMatchObject({
            ownerId: 'project-1__tasks__task-1__message-1',
            kind: 'chat',
        })
    })

    test('releases the task-level activity lock when the comment run settles', async () => {
        const db = createFakeDb()
        const commentLock = await acquireAssistantRunLock(db, baseParams, () => 1000)

        await completeAssistantRunLock(commentLock.lockRef, {}, () => 2000)
        const workflowLock = await acquireAssistantTaskRunLock(
            db,
            {
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                ownerId: 'workflow-run-1',
                kind: 'workflow',
            },
            () => 3000
        )

        expect(workflowLock.acquired).toBe(true)
        expect(db.docs.get('assistantTaskRunLocks/project-1__tasks__task-1')).toMatchObject({
            ownerId: 'workflow-run-1',
            kind: 'workflow',
            status: 'running',
        })
    })

    test('skips an active duplicate run for the same message', async () => {
        const db = createFakeDb({
            'assistantRunLocks/project-1__tasks__task-1__message-1': {
                status: 'running',
                lockExpiresAt: 5000,
            },
        })

        const result = await acquireAssistantRunLock(db, baseParams, () => 1000)

        expect(result.acquired).toBe(false)
        expect(result.reason).toBe('already_running')
    })

    test('skips a duplicate after the first run completed', async () => {
        const db = createFakeDb()
        const first = await acquireAssistantRunLock(db, baseParams, () => 1000)
        await completeAssistantRunLock(first.lockRef, {}, () => 2000)

        const duplicate = await acquireAssistantRunLock(db, baseParams, () => 3000)

        expect(duplicate.acquired).toBe(false)
        expect(duplicate.reason).toBe('already_completed')
    })

    test('allows takeover of an expired running lock', async () => {
        const db = createFakeDb({
            'assistantRunLocks/project-1__tasks__task-1__message-1': {
                status: 'running',
                lockExpiresAt: 500,
            },
        })

        const result = await acquireAssistantRunLock(db, baseParams, () => 1000)

        expect(result.acquired).toBe(true)
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            status: 'running',
            previousStatus: 'running',
            lockExpiresAt: 1000 + ASSISTANT_RUN_LOCK_LEASE_MS,
        })
    })

    test('failed locks do not permanently block manual retries', async () => {
        const db = createFakeDb()
        const first = await acquireAssistantRunLock(db, baseParams, () => 1000)
        await failAssistantRunLock(first.lockRef, new Error('boom'), () => 2000)

        const retry = await acquireAssistantRunLock(db, baseParams, () => 3000)

        expect(retry.acquired).toBe(true)
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            status: 'running',
            previousStatus: 'failed',
        })
    })

    test('requests cancellation for a running lock and treats it as active until observed', async () => {
        const db = createFakeDb()
        const first = await acquireAssistantRunLock(db, baseParams, () => 1000)

        const result = await requestCancelAssistantRunLock(first.lockRef, 'user-1', () => 2000)

        expect(result.success).toBe(true)
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            status: 'cancel_requested',
            cancelRequestedAt: 2000,
            cancelRequestedBy: 'user-1',
        })
        expect(shouldSkipExistingRun(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1'), 2500)).toBe(
            true
        )
    })

    test('does not let another user cancel a running lock', async () => {
        const db = createFakeDb()
        const first = await acquireAssistantRunLock(db, baseParams, () => 1000)

        const result = await requestCancelAssistantRunLock(first.lockRef, 'user-2', () => 2000)

        expect(result).toMatchObject({ success: false, reason: 'permission_denied' })
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            status: 'running',
        })
    })

    test('marks cancel requested locks as cancelled and allows a manual retry later', async () => {
        const db = createFakeDb()
        const first = await acquireAssistantRunLock(db, baseParams, () => 1000)
        await requestCancelAssistantRunLock(first.lockRef, 'user-1', () => 2000)
        await cancelAssistantRunLock(first.lockRef, {}, () => 3000)

        const retry = await acquireAssistantRunLock(db, baseParams, () => 4000)

        expect(retry.acquired).toBe(true)
        expect(db.docs.get('assistantRunLocks/project-1__tasks__task-1__message-1')).toMatchObject({
            status: 'running',
            previousStatus: 'cancelled',
        })
    })
})
