const {
    VM_WORKFLOW_HOLD_FIELD,
    VM_HOLD_REASON_FAILURE,
    VM_HOLD_REASON_INTERACTION,
    buildVmFailureHoldUpdate,
    buildVmFailureHoldReleaseUpdate,
    resolveVmInteractionWorkflowHold,
    applyVmFailureWorkflowHold,
    prepareVmFailureHoldForRun,
    restoreVmFailureWorkflowHold,
} = require('./vmWorkflowHold')

const workflowTask = (overrides = {}) => ({
    userId: 'user-1',
    userIds: ['user-1', 'assistant-1'],
    currentReviewerId: 'assistant-1',
    stepHistory: [-1, 'ai-step'],
    ...overrides,
})

const fakeDb = store => ({
    doc: path => ({
        path,
        get: async () => ({ exists: store[path] !== undefined, data: () => store[path] }),
        set: (data, opts) => {
            store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : { ...data }
        },
    }),
    runTransaction: async fn =>
        fn({
            get: target => target.get(),
            set: (target, data, opts) => target.set(data, opts),
        }),
})

describe('VM failure workflow hold', () => {
    test('hands the task to the requesting user without touching the workflow step', () => {
        const task = workflowTask()
        const update = buildVmFailureHoldUpdate(task, {
            correlationId: 'run-1',
            reviewerId: 'user-1',
            triggeredAt: 1000,
            failureReason: 'runtime_timeout',
            claimableReviewerIds: ['assistant-1'],
        })

        expect(update).toEqual({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                requestId: null,
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                workflowStepId: 'ai-step',
                triggeredAt: 1000,
                reason: VM_HOLD_REASON_FAILURE,
                failureReason: 'runtime_timeout',
            },
        })
        // The step itself must be untouched: no stepHistory growth, no done/completed flags,
        // no subtask moves. Only the reviewer changes.
        expect(Object.keys(update)).toEqual(['currentReviewerId', VM_WORKFLOW_HOLD_FIELD])
        expect(task.stepHistory).toEqual([-1, 'ai-step'])
    })

    test('is a no-op when the task is already the user to act on', () => {
        expect(
            buildVmFailureHoldUpdate(workflowTask({ currentReviewerId: 'user-1' }), {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                triggeredAt: 1000,
            })
        ).toBeNull()
    })

    test('never steals a task another live VM job is holding', () => {
        const task = workflowTask({
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'other-run',
                requestId: 'request-9',
                reviewerId: 'user-2',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_INTERACTION,
            },
        })

        expect(
            buildVmFailureHoldUpdate(task, {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                triggeredAt: 1000,
                claimableReviewerIds: ['assistant-1'],
            })
        ).toBeNull()
    })

    test('converts its own unanswered question hold into a failure hold, keeping the displaced reviewer', () => {
        const task = workflowTask({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                requestId: 'request-1',
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                workflowStepId: 'ai-step',
                triggeredAt: 500,
                reason: VM_HOLD_REASON_INTERACTION,
            },
        })

        const update = buildVmFailureHoldUpdate(task, {
            correlationId: 'run-1',
            reviewerId: 'user-1',
            triggeredAt: 1000,
            failureReason: 'interaction_expired',
        })

        expect(update).toMatchObject({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                reason: VM_HOLD_REASON_FAILURE,
                requestId: null,
                previousReviewerId: 'assistant-1',
                failureReason: 'interaction_expired',
                triggeredAt: 1000,
            },
        })
    })

    test('does not re-apply a failure hold it already owns', () => {
        const task = workflowTask({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_FAILURE,
            },
        })

        expect(
            buildVmFailureHoldUpdate(task, { correlationId: 'run-1', reviewerId: 'user-1', triggeredAt: 2000 })
        ).toBeNull()
    })

    test('leaves a task a human already took over during the run', () => {
        // A run has five hours to fail, and a question a full day to expire. If a person moved the
        // task on meanwhile it is visible to a human already, and that decision outranks the hold.
        expect(
            buildVmFailureHoldUpdate(workflowTask({ currentReviewerId: 'bob' }), {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                triggeredAt: 1000,
                claimableReviewerIds: ['assistant-1'],
            })
        ).toBeNull()
    })

    test('claims a task nobody is reviewing', () => {
        expect(
            buildVmFailureHoldUpdate(workflowTask({ currentReviewerId: null }), {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                triggeredAt: 1000,
                claimableReviewerIds: ['assistant-1'],
            })
        ).toMatchObject({ currentReviewerId: 'user-1' })
    })

    test('does not release another user’s failure hold when a new run starts', () => {
        const task = workflowTask({
            currentReviewerId: 'user-2',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                reviewerId: 'user-2',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_FAILURE,
            },
        })

        expect(buildVmFailureHoldReleaseUpdate(task, { reviewerId: 'user-1' })).toBeNull()
        expect(buildVmFailureHoldReleaseUpdate(task, { reviewerId: 'user-2' })).toEqual({
            currentReviewerId: 'assistant-1',
            [VM_WORKFLOW_HOLD_FIELD]: null,
        })
    })

    test('gives the step back to the displaced reviewer when a new run starts', () => {
        const task = workflowTask({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_FAILURE,
            },
        })

        expect(buildVmFailureHoldReleaseUpdate(task)).toEqual({
            currentReviewerId: 'assistant-1',
            [VM_WORKFLOW_HOLD_FIELD]: null,
        })
    })

    test('keeps a newer manual workflow move when releasing, and only clears the bookkeeping', () => {
        const task = workflowTask({
            currentReviewerId: 'reviewer-2',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_FAILURE,
            },
        })

        expect(buildVmFailureHoldReleaseUpdate(task)).toEqual({ [VM_WORKFLOW_HOLD_FIELD]: null })
    })

    test('leaves an open question hold alone when a run starts', () => {
        const task = workflowTask({
            currentReviewerId: 'user-1',
            [VM_WORKFLOW_HOLD_FIELD]: {
                correlationId: 'run-1',
                requestId: 'request-1',
                reviewerId: 'user-1',
                previousReviewerId: 'assistant-1',
                reason: VM_HOLD_REASON_INTERACTION,
            },
        })

        expect(buildVmFailureHoldReleaseUpdate(task)).toBeNull()
    })

    test('a question hold written before failure holds existed is still treated as an interaction', () => {
        const legacyHold = {
            correlationId: 'run-1',
            requestId: 'request-1',
            reviewerId: 'user-1',
            previousReviewerId: 'assistant-1',
        }
        expect(buildVmFailureHoldReleaseUpdate(workflowTask({ [VM_WORKFLOW_HOLD_FIELD]: legacyHold }))).toBeNull()
    })

    test('question holds keep their existing semantics', () => {
        const task = workflowTask()
        const { hold, changed } = resolveVmInteractionWorkflowHold(task, 'run-1', 'request-1', 'user-1', 1000)

        expect(changed).toBe(true)
        expect(hold).toMatchObject({
            reviewerId: 'user-1',
            previousReviewerId: 'assistant-1',
            workflowStepId: 'ai-step',
            reason: VM_HOLD_REASON_INTERACTION,
        })
    })

    describe('persistence helpers', () => {
        test('applies and then releases the hold across runs', async () => {
            const store = { 'items/project-1/tasks/task-1': workflowTask() }
            const db = fakeDb(store)
            const pending = { projectId: 'project-1', objectId: 'task-1', objectType: 'tasks' }

            await applyVmFailureWorkflowHold(db, pending, {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                now: 1000,
                failureReason: 'failed',
                claimableReviewerIds: ['assistant-1'],
            })
            expect(store['items/project-1/tasks/task-1']).toMatchObject({
                currentReviewerId: 'user-1',
                stepHistory: [-1, 'ai-step'],
            })

            await prepareVmFailureHoldForRun(db, { ...pending, userId: 'user-1' })
            expect(store['items/project-1/tasks/task-1']).toMatchObject({
                currentReviewerId: 'assistant-1',
                [VM_WORKFLOW_HOLD_FIELD]: null,
                stepHistory: [-1, 'ai-step'],
            })
        })

        test('run start reports the reviewer this run may claim back on failure', async () => {
            const store = { 'items/project-1/tasks/task-1': workflowTask() }
            const db = fakeDb(store)
            const pending = { projectId: 'project-1', objectId: 'task-1', objectType: 'tasks', userId: 'user-1' }

            await expect(prepareVmFailureHoldForRun(db, pending)).resolves.toEqual({
                releasedHold: null,
                reviewerAtRunStart: 'assistant-1',
            })
        })

        test('restores a hold the thread-busy deferral released, but never overwrites a newer one', async () => {
            const store = { 'items/project-1/tasks/task-1': workflowTask() }
            const db = fakeDb(store)
            const pending = { projectId: 'project-1', objectId: 'task-1', objectType: 'tasks', userId: 'user-1' }

            await applyVmFailureWorkflowHold(db, pending, {
                correlationId: 'run-1',
                reviewerId: 'user-1',
                now: 1000,
                claimableReviewerIds: ['assistant-1'],
            })
            const { releasedHold } = await prepareVmFailureHoldForRun(db, pending)
            expect(store['items/project-1/tasks/task-1'].currentReviewerId).toBe('assistant-1')

            await expect(restoreVmFailureWorkflowHold(db, pending, releasedHold)).resolves.toBe(true)
            expect(store['items/project-1/tasks/task-1']).toMatchObject({
                currentReviewerId: 'user-1',
                stepHistory: [-1, 'ai-step'],
            })

            // Someone moved the task on before the restore could land: leave it alone.
            store['items/project-1/tasks/task-1'] = workflowTask({ currentReviewerId: 'bob' })
            await expect(restoreVmFailureWorkflowHold(db, pending, releasedHold)).resolves.toBe(false)
            expect(store['items/project-1/tasks/task-1'].currentReviewerId).toBe('bob')
        })

        test('ignores non-task threads such as topics', async () => {
            const store = {}
            const db = fakeDb(store)
            const applied = await applyVmFailureWorkflowHold(
                db,
                { projectId: 'project-1', objectId: 'topic-1', objectType: 'topics' },
                { correlationId: 'run-1', reviewerId: 'user-1', now: 1000, claimableReviewerIds: ['assistant-1'] }
            )

            expect(applied).toBe(false)
            expect(store).toEqual({})
        })
    })
})
