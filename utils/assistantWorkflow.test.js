import {
    ASSISTANT_WORKFLOW_FIRST_STEP_ID,
    DEFAULT_ASSISTANT_WORKFLOW_PROMPT,
    assistantWorkflowFirstStepHasPrompt,
    buildAssistantWorkflowFirstStep,
    buildAssistantWorkflowTask,
    resolveAssistantWorkflowExecutionMode,
} from './assistantWorkflow'

describe('assistant workflow', () => {
    it('builds a locked AI first step assigned to the assistant', () => {
        expect(buildAssistantWorkflowFirstStep('assistant-1', 'user-1', 123)).toMatchObject({
            reviewerUid: 'assistant-1',
            reviewerType: 'assistant',
            aiPrompt: 'Do this',
            sortIndex: 0,
            addedById: 'user-1',
            date: 123,
        })
        expect(DEFAULT_ASSISTANT_WORKFLOW_PROMPT).toBe('Do this')
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

    it('runs directly when workflow mode is requested without a configured first step', () => {
        expect(resolveAssistantWorkflowExecutionMode({ uid: 'assistant-1' }, 'project-1', 'workflow')).toBe('direct')
        expect(
            resolveAssistantWorkflowExecutionMode(
                {
                    workflow: {
                        'project-1': {
                            [ASSISTANT_WORKFLOW_FIRST_STEP_ID]: { reviewerUid: 'assistant-1' },
                        },
                    },
                },
                'project-1',
                'workflow'
            )
        ).toBe('direct')
    })

    it('preserves workflow mode when the first step is configured', () => {
        const assistant = {
            workflow: {
                'project-1': {
                    [ASSISTANT_WORKFLOW_FIRST_STEP_ID]: {
                        reviewerUid: 'assistant-1',
                        reviewerType: 'assistant',
                    },
                },
            },
        }

        expect(resolveAssistantWorkflowExecutionMode(assistant, 'project-1', 'workflow')).toBe('workflow')
    })

    it('preserves direct mode and safely bypasses an unresolved assistant workflow', () => {
        expect(resolveAssistantWorkflowExecutionMode({ uid: 'assistant-1' }, 'project-1', 'direct')).toBe('direct')
        expect(resolveAssistantWorkflowExecutionMode(null, 'project-1', 'workflow')).toBe('direct')
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
