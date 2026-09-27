const {
    claimScheduledPromptAttempt,
    failedScheduledAttempt,
    hasActiveAttempt,
    scheduledPromptHash,
} = require('./scheduledAssistantContinuation')

function database(initial) {
    let data = initial
    const taskRef = {
        firestore: {
            runTransaction: async run =>
                run({
                    get: async () => ({ exists: true, data: () => data }),
                    update: (_, update) => {
                        data = {
                            ...data,
                            ...update,
                            executionByUser: { ...data.executionByUser, user: update['executionByUser.user'] },
                        }
                    },
                }),
        },
    }
    return {
        taskRef,
        get: () => data,
        set: value => {
            data = value
        },
    }
}
const task = { prompt: 'Update every project', lastExecutedByUser: { user: 100 } }

test('reserves a thread before running, refuses duplicate delivery, and resumes a failed attempt in the same thread', async () => {
    const db = database(task)
    const args = { taskRef: db.taskRef, userId: 'user', task, executionProjectId: 'p', newTaskId: 'first', now: 1000 }
    const first = await claimScheduledPromptAttempt(args)
    expect(first).toMatchObject({ taskId: 'first', resume: false })
    expect(await claimScheduledPromptAttempt({ ...args, newTaskId: 'duplicate' })).toBeNull()
    const failed = failedScheduledAttempt(first, new Error('Temporary failure'), 'p1,p2', 2000)
    db.set({ ...db.get(), executionByUser: { user: failed } })
    expect(await claimScheduledPromptAttempt({ ...args, newTaskId: 'should-not-use', now: 3000 })).toMatchObject({
        taskId: 'first',
        resume: true,
        attempts: 2,
        stalledAttempts: 0,
    })
})

test('a process exit is recoverable after its lease expires', async () => {
    const db = database(task)
    const args = { taskRef: db.taskRef, userId: 'user', task, executionProjectId: 'p', newTaskId: 'first', now: 1000 }
    const first = await claimScheduledPromptAttempt(args)
    expect(hasActiveAttempt(first, first.leaseExpiresAt - 1)).toBe(true)
    expect(
        await claimScheduledPromptAttempt({ ...args, now: first.leaseExpiresAt + 1, newTaskId: 'duplicate' })
    ).toMatchObject({ taskId: 'first', resume: true })
})

test('new schedules or changed instructions never inherit the old completed-project receipts', async () => {
    const old = { status: 'failed', taskId: 'old', promptHash: scheduledPromptHash(task, 'p'), executionProjectId: 'p' }
    const changed = { ...task, prompt: 'A different task', executionByUser: { user: old } }
    const db = database(changed)
    expect(
        await claimScheduledPromptAttempt({
            taskRef: db.taskRef,
            userId: 'user',
            task: changed,
            executionProjectId: 'p',
            newTaskId: 'new',
            now: 1000,
        })
    ).toMatchObject({ taskId: 'new', resume: false })
})

test('stale scheduler scans cannot rerun a completed occurrence or an edited prompt', async () => {
    const db = database({ ...task, lastExecutedByUser: { user: 500 } })
    const args = { taskRef: db.taskRef, userId: 'user', task, executionProjectId: 'p', newTaskId: 'new' }
    expect(await claimScheduledPromptAttempt(args)).toBeNull()
    db.set({ ...task, prompt: 'Edited while scanning' })
    expect(await claimScheduledPromptAttempt(args)).toBeNull()
})

test('three attempts without new completed units exhaust retries, but new progress resets the counter', () => {
    let attempt = { stalledAttempts: 0, progressSignature: 'p1', attempts: 1, taskId: 'same' }
    for (let i = 0; i < 3; i++) attempt = failedScheduledAttempt(attempt, new Error('Blocked'), 'p1')
    expect(attempt).toMatchObject({ retryExhausted: true, stalledAttempts: 3, taskId: 'same', status: 'failed' })
    expect(failedScheduledAttempt(attempt, new Error('Transient'), 'p1,p2')).toMatchObject({
        retryExhausted: false,
        stalledAttempts: 0,
    })
})

test('an expired attempt cannot overwrite a newer attempt status', async () => {
    const { updateScheduledAttempt } = require('./scheduledAssistantContinuation')
    const db = database(task)
    const args = { taskRef: db.taskRef, userId: 'user', task, executionProjectId: 'p', newTaskId: 'first', now: 1000 }
    const first = await claimScheduledPromptAttempt(args)
    const second = await claimScheduledPromptAttempt({ ...args, now: first.leaseExpiresAt + 1 })
    expect(await updateScheduledAttempt(db.taskRef, 'user', first, { executionStatus: 'failed' })).toBe(false)
    expect(db.get().executionStatus).toBe('in_progress')
    expect(await updateScheduledAttempt(db.taskRef, 'user', second, { executionStatus: 'failed' })).toBe(true)
})
