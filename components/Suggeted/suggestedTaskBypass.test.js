jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromOpen: jest.fn(),
    updateSubtasksState: jest.fn(),
    updateTaskData: jest.fn(),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ DONE_STEP: 'done' }))
jest.mock('../Feeds/Utils/HelperFunctions', () => ({ FORDWARD_COMMENT: 'forward' }))

const { moveTasksFromOpen, updateSubtasksState, updateTaskData } = require('../../utils/backends/Tasks/tasksFirestore')
const {
    ACCEPT_AND_DONE_LABEL,
    BYPASS_WORKFLOW_LABEL,
    canBypassSuggestedTaskWorkflow,
    getSuggestedTaskBypassLabel,
    moveSuggestedTaskToDoneBypassingWorkflow,
    userHasWorkflowInProject,
} = require('./suggestedTaskBypass')

const ASSISTANT_ID = 'assistant-1'
// An email/Gmail follow-up task the assistant suggested: `suggestedBy` is the assistant id and
// `taskMetadata.assistantSuggestion.assistantId` marks it as an assistant suggestion.
const assistantSuggestedEmailTask = {
    id: 'task-2',
    suggestedBy: ASSISTANT_ID,
    creatorId: ASSISTANT_ID,
    taskMetadata: { assistantSuggestion: { assistantId: ASSISTANT_ID } },
    gmailData: { origin: 'gmail_label_follow_up', threadId: 'thread-1' },
}
const humanSuggestedTask = { id: 'task-3', suggestedBy: 'suggester-1', creatorId: 'suggester-1' }

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
        const userWithWorkflow = { workflow: { 'project-1': { 'step-1': { description: 'Review' } } } }
        const userWithoutWorkflow = { workflow: { 'project-1': {} } }

        it('offers the bypass when the accepting user has workflow steps in the project', () => {
            expect(canBypassSuggestedTaskWorkflow(userWithWorkflow, 'project-1', humanSuggestedTask)).toBe(true)
            expect(userHasWorkflowInProject(userWithWorkflow, 'project-1')).toBe(true)
        })

        it('hides the bypass on a human suggestion when there is no workflow to skip', () => {
            // Without a workflow "Go to next step" already moves the task to Done.
            expect(canBypassSuggestedTaskWorkflow(userWithoutWorkflow, 'project-1', humanSuggestedTask)).toBe(false)
            expect(canBypassSuggestedTaskWorkflow({ workflow: {} }, 'project-1', humanSuggestedTask)).toBe(false)
            expect(canBypassSuggestedTaskWorkflow({}, 'project-1', humanSuggestedTask)).toBe(false)
            expect(canBypassSuggestedTaskWorkflow(undefined, 'project-1', humanSuggestedTask)).toBe(false)
        })

        it('hides the bypass when the workflow belongs to another project', () => {
            const user = { workflow: { 'project-2': { 'step-1': { description: 'Review' } } } }

            expect(canBypassSuggestedTaskWorkflow(user, 'project-1', humanSuggestedTask)).toBe(false)
        })

        // AT-2164 regression: a suggested email task is an assistant suggestion, whose secondary
        // action is "Reject" (hands the task back to the assistant) rather than "Go to next step".
        // There is therefore no route to Done, so the bypass must be offered even without a workflow.
        it('offers the bypass on an assistant suggestion in a project without a workflow', () => {
            expect(canBypassSuggestedTaskWorkflow(userWithoutWorkflow, 'project-1', assistantSuggestedEmailTask)).toBe(
                true
            )
            expect(canBypassSuggestedTaskWorkflow({}, 'project-1', assistantSuggestedEmailTask)).toBe(true)
            expect(canBypassSuggestedTaskWorkflow(undefined, 'project-1', assistantSuggestedEmailTask)).toBe(true)
        })

        it('still offers the bypass on an assistant suggestion when a workflow exists', () => {
            expect(canBypassSuggestedTaskWorkflow(userWithWorkflow, 'project-1', assistantSuggestedEmailTask)).toBe(
                true
            )
        })

        it('recognises the legacy assistant suggestion shape stored on the task itself', () => {
            const legacy = { id: 'task-4', suggestedBy: ASSISTANT_ID, assistantId: ASSISTANT_ID }

            expect(canBypassSuggestedTaskWorkflow(userWithoutWorkflow, 'project-1', legacy)).toBe(true)
        })
    })

    describe('getSuggestedTaskBypassLabel', () => {
        it('says the workflow is bypassed when there is one to skip', () => {
            const user = { workflow: { 'project-1': { 'step-1': { description: 'Review' } } } }

            expect(getSuggestedTaskBypassLabel(user, 'project-1')).toBe(BYPASS_WORKFLOW_LABEL)
        })

        it('says the task is accepted and completed when there is no workflow', () => {
            expect(getSuggestedTaskBypassLabel({ workflow: { 'project-1': {} } }, 'project-1')).toBe(
                ACCEPT_AND_DONE_LABEL
            )
            expect(getSuggestedTaskBypassLabel(undefined, 'project-1')).toBe(ACCEPT_AND_DONE_LABEL)
        })

        it('is localized in every supported language', () => {
            const translations = {
                en: require('../../i18n/translations/en.json'),
                de: require('../../i18n/translations/de.json'),
                es: require('../../i18n/translations/es.json'),
            }

            Object.values(translations).forEach(dictionary => {
                expect(typeof dictionary[BYPASS_WORKFLOW_LABEL]).toBe('string')
                expect(dictionary[BYPASS_WORKFLOW_LABEL]).not.toBe('')
                expect(typeof dictionary[ACCEPT_AND_DONE_LABEL]).toBe('string')
                expect(dictionary[ACCEPT_AND_DONE_LABEL]).not.toBe('')
            })
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
