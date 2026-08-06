jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromOpen: jest.fn(),
    updateSubtasksState: jest.fn(),
    updateTaskData: jest.fn(),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ DONE_STEP: 'done' }))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ FORDWARD_COMMENT: 'forward' }))

const { moveTasksFromOpen, updateSubtasksState, updateTaskData } = require('../../utils/backends/Tasks/tasksFirestore')
const {
    canBypassSuggestedTaskWorkflow,
    moveSuggestedTaskToDoneBypassingWorkflow,
    userHasWorkflowInProject,
} = require('./suggestedTaskBypass')

const transition = {
    projectId: 'project-1',
    task: {
        id: 'task-1',
        userIds: ['owner-1'],
        subtaskIds: ['subtask-1'],
        suggestedBy: 'suggester-1',
        executionMode: 'workflow',
    },
    estimations: { '-1': 30 },
    comment: 'Already handled this',
    checkBoxId: 'checkbox-1',
}

describe('suggested task workflow bypass', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('canBypassSuggestedTaskWorkflow', () => {
        it('offers the bypass when the accepting user has workflow steps in the project', () => {
            const user = { workflow: { 'project-1': { 'step-1': { description: 'Review' } } } }

            expect(canBypassSuggestedTaskWorkflow(user, 'project-1')).toBe(true)
            expect(userHasWorkflowInProject(user, 'project-1')).toBe(true)
        })

        it('hides the bypass when there is no workflow to skip', () => {
            expect(canBypassSuggestedTaskWorkflow({ workflow: { 'project-1': {} } }, 'project-1')).toBe(false)
            expect(canBypassSuggestedTaskWorkflow({ workflow: {} }, 'project-1')).toBe(false)
            expect(canBypassSuggestedTaskWorkflow({}, 'project-1')).toBe(false)
            expect(canBypassSuggestedTaskWorkflow(undefined, 'project-1')).toBe(false)
        })

        it('hides the bypass when the workflow belongs to another project', () => {
            const user = { workflow: { 'project-2': { 'step-1': { description: 'Review' } } } }

            expect(canBypassSuggestedTaskWorkflow(user, 'project-1')).toBe(false)
        })
    })

    describe('moveSuggestedTaskToDoneBypassingWorkflow', () => {
        it('moves the suggested task straight to Done with the direct execution mode', () => {
            moveSuggestedTaskToDoneBypassingWorkflow(transition)

            expect(moveTasksFromOpen).toHaveBeenCalledWith(
                'project-1',
                { ...transition.task, executionMode: 'direct' },
                'done',
                'Already handled this',
                'forward',
                { '-1': 30 },
                'checkbox-1'
            )
        })

        it('accepts the suggestion for the task and its subtasks', () => {
            moveSuggestedTaskToDoneBypassingWorkflow(transition)

            expect(updateTaskData).toHaveBeenCalledWith('project-1', 'task-1', { suggestedBy: null }, null)
            expect(updateSubtasksState).toHaveBeenCalledWith('project-1', ['subtask-1'], { suggestedBy: null }, null)
        })

        it('does not mutate the task it was given', () => {
            moveSuggestedTaskToDoneBypassingWorkflow(transition)

            expect(transition.task.executionMode).toBe('workflow')
            expect(transition.task.suggestedBy).toBe('suggester-1')
        })
    })
})
