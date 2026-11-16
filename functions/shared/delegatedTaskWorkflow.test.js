const { DELEGATION_REVIEW_STEP, withDelegationReviewStep } = require('./delegatedTaskWorkflow')
const { buildDelegatedTaskFields } = require('../Assistant/annaTaskDelegation')
const { TaskService } = require('./TaskService')

const task = { id: 'task', name: 'Fix login', ...buildDelegatedTaskFields('owner', 'cto') }
const aiStep = { reviewerUid: 'cto', reviewerType: 'assistant', aiPrompt: 'Implement this task' }

test('adds a final owner review after legacy and explicitly ordered steps without editing the saved workflow', () => {
    const workflow = { b: { ...aiStep, sortIndex: 0 }, a: { reviewerUid: 'other' }, c: aiStep }
    const before = JSON.stringify(workflow)
    const result = withDelegationReviewStep(workflow, task)
    expect(Object.keys(result)).toEqual(['b', 'a', 'c', DELEGATION_REVIEW_STEP])
    expect(result[DELEGATION_REVIEW_STEP]).toMatchObject({ reviewerUid: 'owner', description: 'Review result' })
    expect(JSON.stringify(workflow)).toBe(before)
})

test('uses an existing final owner review without adding another one', () => {
    const result = withDelegationReviewStep({ implement: aiStep, review: { reviewerUid: 'owner' } }, task)
    expect(Object.keys(result)).toEqual(['implement', 'review'])
})

test('keeps a task already standing on its review step visible after the saved workflow changes', () => {
    const reviewing = { ...task, stepHistory: ['Open', 'implement', DELEGATION_REVIEW_STEP] }
    for (const workflow of [{}, { implement: aiStep, review: { reviewerUid: 'owner' } }]) {
        expect(withDelegationReviewStep(workflow, reviewing)[DELEGATION_REVIEW_STEP]).toMatchObject({
            reviewerUid: 'owner',
        })
    }
})

test('does not add review steps to ordinary, legacy assistant-owned or explicitly direct tasks', () => {
    const workflow = { implement: aiStep }
    for (const other of [
        {},
        { ...task, executionMode: 'direct' },
        { ...task, userId: 'cto' },
        buildDelegatedTaskFields('owner', 'cto', 'direct'),
    ]) {
        expect(withDelegationReviewStep(workflow, other)).toBe(workflow)
    }
})

describe('delegated task completion', () => {
    let service
    beforeEach(async () => {
        service = new TaskService({ enableFeeds: false, enableValidation: false })
        await service.initialize()
    })

    test.each([
        { currentReviewerId: 'cto', stepHistory: ['Open', 'implement'] },
        { currentReviewerId: 'owner', stepHistory: ['Open'] },
        { currentReviewerId: 'owner', stepHistory: ['Open', 'prerequisite'] },
    ])('prevents completion before the human review (%j)', async state => {
        await expect(
            service.updateTask({
                taskId: 'task',
                projectId: 'project',
                currentTask: { ...task, ...state },
                completed: true,
            })
        ).rejects.toThrow('human review')
    })

    test('allows completion after the workflow has returned to the owner review', async () => {
        const result = await service.updateTask({
            taskId: 'task',
            projectId: 'project',
            currentTask: {
                ...task,
                currentReviewerId: 'owner',
                stepHistory: ['Open', 'implement', DELEGATION_REVIEW_STEP],
            },
            completed: true,
        })
        expect(result.updateData).toMatchObject({
            done: true,
            inDone: true,
            currentReviewerId: 'Done',
            userIds: ['owner'],
        })
    })

    test('allows explicit direct execution to bypass review', async () => {
        const result = await service.updateTask({
            taskId: 'task',
            projectId: 'project',
            currentTask: task,
            executionMode: 'direct',
            completed: true,
        })
        expect(result.updateData).toMatchObject({ done: true, executionMode: 'direct' })
    })
})
