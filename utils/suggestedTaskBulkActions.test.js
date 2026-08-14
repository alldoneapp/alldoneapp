import { acceptAllSuggestedTasks, rejectAllSuggestedTasks } from './suggestedTaskBulkActions'
import { nextStepSuggestedTask, updateSuggestedTask } from './backends/Tasks/tasksFirestore'

jest.mock('./backends/Tasks/tasksFirestore', () => ({
    nextStepSuggestedTask: jest.fn(() => Promise.resolve()),
    updateSuggestedTask: jest.fn(),
}))
jest.mock('./HelperFunctions', () => ({
    getWorkflowStepsIdsSorted: workflow => Object.keys(workflow).sort(),
}))

const task = (id, extra = {}) => ({ id, suggestedBy: 'assistant-1', estimations: { '-1': 2 }, ...extra })

describe('accepting a whole suggested section', () => {
    beforeEach(() => jest.clearAllMocks())

    test('clears the suggestion on every task without touching assignee or estimation', () => {
        const accepted = acceptAllSuggestedTasks({ projectId: 'project-1', tasks: [task('task-1'), task('task-2')] })

        expect(accepted).toBe(2)
        expect(updateSuggestedTask).toHaveBeenCalledTimes(2)
        expect(updateSuggestedTask).toHaveBeenNthCalledWith(1, 'project-1', 'task-1', { suggestedBy: null })
        expect(updateSuggestedTask).toHaveBeenNthCalledWith(2, 'project-1', 'task-2', { suggestedBy: null })
        expect(nextStepSuggestedTask).not.toHaveBeenCalled()
    })

    test('is a no-op for an empty or malformed section', () => {
        expect(acceptAllSuggestedTasks({ projectId: 'project-1', tasks: [] })).toBe(0)
        expect(acceptAllSuggestedTasks({ projectId: 'project-1', tasks: undefined })).toBe(0)
        expect(acceptAllSuggestedTasks({ projectId: 'project-1', tasks: [null, {}] })).toBe(0)
        expect(updateSuggestedTask).not.toHaveBeenCalled()
    })
})

describe('rejecting a whole suggested section', () => {
    beforeEach(() => jest.clearAllMocks())

    test('moves every task to Done when the reviewer has no workflow', async () => {
        const tasks = [task('task-1'), task('task-2')]

        const rejected = await rejectAllSuggestedTasks({ projectId: 'project-1', tasks, workflow: {} })

        expect(rejected).toBe(2)
        expect(nextStepSuggestedTask).toHaveBeenCalledTimes(2)
        expect(nextStepSuggestedTask).toHaveBeenNthCalledWith(
            1,
            'project-1',
            -2,
            tasks[0],
            tasks[0].estimations,
            '',
            null
        )
        expect(nextStepSuggestedTask).toHaveBeenNthCalledWith(
            2,
            'project-1',
            -2,
            tasks[1],
            tasks[1].estimations,
            '',
            null
        )
        expect(updateSuggestedTask).not.toHaveBeenCalled()
    })

    test('routes the rejection into the first workflow step when the reviewer has a workflow', async () => {
        const workflow = { 'step-b': { reviewerUid: 'user-2' }, 'step-a': { reviewerUid: 'user-1' } }

        await rejectAllSuggestedTasks({ projectId: 'project-1', tasks: [task('task-1')], workflow })

        expect(nextStepSuggestedTask).toHaveBeenCalledWith(
            'project-1',
            'step-a',
            expect.objectContaining({ id: 'task-1' }),
            { '-1': 2 },
            '',
            null
        )
    })

    test('rejects sequentially so the open-list reordering cannot race', async () => {
        const order = []
        nextStepSuggestedTask.mockImplementation((projectId, stepId, rejectedTask) => {
            order.push(`start:${rejectedTask.id}`)
            return Promise.resolve().then(() => {
                order.push(`end:${rejectedTask.id}`)
            })
        })

        await rejectAllSuggestedTasks({ projectId: 'project-1', tasks: [task('task-1'), task('task-2')], workflow: {} })

        expect(order).toEqual(['start:task-1', 'end:task-1', 'start:task-2', 'end:task-2'])
    })

    test('is a no-op for an empty section', async () => {
        expect(await rejectAllSuggestedTasks({ projectId: 'project-1', tasks: [], workflow: {} })).toBe(0)
        expect(await rejectAllSuggestedTasks({ projectId: 'project-1', tasks: undefined, workflow: {} })).toBe(0)
        expect(nextStepSuggestedTask).not.toHaveBeenCalled()
    })
})
