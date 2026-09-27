const {
    compactionArgumentError,
    executeWithCompactionRepair,
    reconcileProjectWorkflow,
    getWorkflowProgress,
    createWorkflowContinuationGuard,
    assertWorkflowComplete,
} = require('./assistantWorkflowProgress')

const ids = Array.from({ length: 13 }, (_, i) => `project-${i + 1}`)
const stateAt = count => ({
    projectWorkflow: {
        catalog: ids.map(id => ({ id, name: id })),
        expectedIds: ids,
        completedIds: ids.slice(0, count),
    },
    progressCompleted: 13,
    progressTotal: 13,
})
const dbFor = state => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state }) }) })
const context = { projectId: 'p', objectType: 'tasks', objectId: 't', assistantId: 'a' }

test.each([2, 5])(
    'repairs the missing compact arguments after %s completed projects without replaying writes',
    async count => {
        const runtime = {}
        const execute = jest
            .fn()
            .mockRejectedValueOnce(compactionArgumentError('progressCompleted must be a non-negative integer'))
            .mockResolvedValueOnce({ success: true, compactedState: { progressCompleted: count, progressTotal: 13 } })
        expect(await executeWithCompactionRepair(runtime, 'compact_thread_context', execute)).toMatchObject({
            success: false,
            retryable: true,
        })
        expect(await executeWithCompactionRepair(runtime, 'compact_thread_context', execute)).toMatchObject({
            success: true,
        })
        expect(runtime.compactionRepairAttempts).toBe(0)
        expect(execute).toHaveBeenCalledTimes(2)
    }
)

test('repeated invalid compact calls stop after two repair opportunities; permission and storage failures propagate', async () => {
    const runtime = {}
    const invalid = async () => {
        throw compactionArgumentError('Missing fields')
    }
    await executeWithCompactionRepair(runtime, 'compact_thread_context', invalid)
    await executeWithCompactionRepair(runtime, 'compact_thread_context', invalid)
    await expect(executeWithCompactionRepair(runtime, 'compact_thread_context', invalid)).rejects.toMatchObject({
        code: 'INVALID_COMPACTION_ARGUMENTS',
    })
    await expect(
        executeWithCompactionRepair({}, 'compact_thread_context', async () => {
            throw new Error('Permission denied')
        })
    ).rejects.toThrow('Permission denied')
    await expect(executeWithCompactionRepair({}, 'update_project_description', invalid)).rejects.toThrow(
        'Missing fields'
    )
})

test('binds the full batch to returned project IDs and counts only verified unique writes', () => {
    const state = stateAt(6)
    delete state.projectWorkflow.expectedIds
    const projectWorkflow = reconcileProjectWorkflow(state, { progressTotal: 13 })
    projectWorkflow.completedIds.push('project-1', 'unrelated-project')
    expect(getWorkflowProgress({ projectWorkflow, progressCompleted: 13 })).toMatchObject({
        completed: 6,
        total: 13,
        next: 'project-7',
    })
    expect(() => reconcileProjectWorkflow({ projectWorkflow }, { progressTotal: 6 })).toThrow('count must equal')
})

test('a subset has an explicit fixed scope; missing projects cannot be silently dropped', () => {
    const state = stateAt(1)
    delete state.projectWorkflow.expectedIds
    expect(() => reconcileProjectWorkflow(state, { progressTotal: 2 })).toThrow('Provide projectIds')
    const projectWorkflow = reconcileProjectWorkflow(state, {
        progressTotal: 2,
        projectIds: ['project-1', 'project-7'],
    })
    expect(getWorkflowProgress({ projectWorkflow })).toMatchObject({ completed: 1, total: 2, next: 'project-7' })
    expect(() =>
        reconcileProjectWorkflow({ projectWorkflow }, { progressTotal: 2, projectIds: ['project-1', 'project-2'] })
    ).toThrow('scope cannot change')
})

test('six of thirteen resumes with project seven; actual progress resets the no-progress bound', () => {
    const guard = createWorkflowContinuationGuard()
    expect(guard(getWorkflowProgress(stateAt(6)))).toContain('project-7')
    expect(guard(getWorkflowProgress(stateAt(6)))).toContain('6/13')
    expect(guard(getWorkflowProgress(stateAt(7)))).toContain('project-8')
    expect(guard(getWorkflowProgress(stateAt(7)))).toContain('7/13')
    expect(() => guard(getWorkflowProgress(stateAt(7)))).toThrow('without progress')
    expect(guard(getWorkflowProgress(stateAt(13)))).toBeNull()
})

test('the completion boundary rejects a normal model response at 6/13 and accepts 13 verified writes', async () => {
    await expect(assertWorkflowComplete(dbFor(stateAt(6)), context)).rejects.toMatchObject({
        code: 'ASSISTANT_WORKFLOW_INCOMPLETE',
    })
    await expect(assertWorkflowComplete(dbFor(stateAt(13)), context)).resolves.toMatchObject({
        completed: 13,
        total: 13,
    })
    await expect(
        assertWorkflowComplete(dbFor(stateAt(13)), context, { guardrailStopped: { message: 'Time limit' } })
    ).rejects.toThrow('Time limit')
    await expect(
        assertWorkflowComplete(dbFor(stateAt(13)), { ...context, compactionRepairAttempts: 1 })
    ).rejects.toThrow('incomplete')
})

test('skipping the first compaction cannot bypass completion, and a catalog lookup does not expand a single-project request', async () => {
    const state = stateAt(1)
    delete state.projectWorkflow.expectedIds
    expect(getWorkflowProgress(state)).toMatchObject({ scopePending: true })
    await expect(assertWorkflowComplete(dbFor(state), context)).rejects.toThrow('scope has not been recorded')
    const projectWorkflow = reconcileProjectWorkflow(state, { progressTotal: 1, projectIds: ['project-1'] })
    await expect(assertWorkflowComplete(dbFor({ projectWorkflow }), context)).resolves.toMatchObject({
        completed: 1,
        total: 1,
    })
})

test('interactive compaction without server receipt tracking remains generic', () => {
    expect(reconcileProjectWorkflow({}, { progressTotal: 2, projectIds: ['p1', 'p2'] })).toBeNull()
    expect(getWorkflowProgress({ progressCompleted: 1, progressTotal: 2 })).toMatchObject({ completed: 1, total: 2 })
})
