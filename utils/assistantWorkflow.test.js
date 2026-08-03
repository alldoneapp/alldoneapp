import {
    ASSISTANT_WORKFLOW_FIRST_STEP_ID,
    assistantWorkflowFirstStepHasPrompt,
    buildAssistantWorkflowFirstStep,
    buildAssistantWorkflowTask,
} from './assistantWorkflow'

describe('assistant workflow', () => {
    it('builds a locked AI first step assigned to the assistant', () => {
        expect(buildAssistantWorkflowFirstStep('assistant-1', 'user-1', 123)).toMatchObject({
            reviewerUid: 'assistant-1',
            reviewerType: 'assistant',
            aiPrompt: '',
            sortIndex: 0,
            addedById: 'user-1',
            date: 123,
        })
    })

    it('requires a non-empty first-step prompt', () => {
        const assistant = {
            workflow: {
                'project-1': {
                    [ASSISTANT_WORKFLOW_FIRST_STEP_ID]: { aiPrompt: '  Run this task  ' },
                },
            },
        }

        expect(assistantWorkflowFirstStepHasPrompt(assistant, 'project-1')).toBe(true)
        assistant.workflow['project-1'][ASSISTANT_WORKFLOW_FIRST_STEP_ID].aiPrompt = '   '
        expect(assistantWorkflowFirstStepHasPrompt(assistant, 'project-1')).toBe(false)
    })

    it('creates an assistant-owned task directly on the first workflow step', () => {
        const task = buildAssistantWorkflowTask({
            assistant: { uid: 'assistant-1' },
            projectId: 'project-1',
            creatorId: 'user-1',
            title: '  Prepare the report  ',
            now: 456,
        })

        expect(task).toMatchObject({
            name: 'Prepare the report',
            userId: 'assistant-1',
            currentReviewerId: 'assistant-1',
            creatorId: 'user-1',
            assistantId: 'assistant-1',
            workflowTask: true,
            workflowPayerUserId: 'user-1',
            stepHistory: [ASSISTANT_WORKFLOW_FIRST_STEP_ID],
            completed: 456,
        })
    })
})
