jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromMiddleOfWorkflow: jest.fn(),
    moveTasksFromOpen: jest.fn(),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ DONE_STEP: 'done' }))

const { moveTasksFromMiddleOfWorkflow, moveTasksFromOpen } = require('../../utils/backends/Tasks/tasksFirestore')
const { getTaskBypassingWorkflow, moveTaskToDoneBypassingWorkflow } = require('./workflowBypass')

const transition = {
    projectId: 'project-1',
    task: { id: 'task-1', userIds: ['owner-1'], executionMode: 'workflow' },
    comment: 'Finished directly',
    commentType: 'forward',
    estimations: { '-1': 30 },
    checkBoxId: 'checkbox-1',
}

describe('workflow bypass', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('sets the task execution mode to direct without mutating the task', () => {
        const task = transition.task

        expect(getTaskBypassingWorkflow(task)).toEqual({ ...task, executionMode: 'direct' })
        expect(task.executionMode).toBe('workflow')
    })

    it('moves an owned task directly to Done with the direct execution mode', async () => {
        await moveTaskToDoneBypassingWorkflow({ ...transition, recurrenceBaseDateOverride: 123 })

        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            'project-1',
            { ...transition.task, executionMode: 'direct' },
            'done',
            'Finished directly',
            'forward',
            { '-1': 30 },
            'checkbox-1',
            123
        )
        expect(moveTasksFromMiddleOfWorkflow).not.toHaveBeenCalled()
    })

    it('moves a task in review directly to Done with the direct execution mode', async () => {
        const task = { ...transition.task, userIds: ['owner-1', 'reviewer-1'] }

        await moveTaskToDoneBypassingWorkflow({ ...transition, task })

        expect(moveTasksFromMiddleOfWorkflow).toHaveBeenCalledWith(
            'project-1',
            { ...task, executionMode: 'direct' },
            'done',
            'Finished directly',
            'forward',
            { '-1': 30 },
            'checkbox-1'
        )
        expect(moveTasksFromOpen).not.toHaveBeenCalled()
    })
})
