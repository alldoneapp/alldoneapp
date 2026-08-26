const {
    TASK_EXECUTION_MODE_DIRECT,
    TASK_EXECUTION_MODE_WORKFLOW,
    getTaskExecutionMode,
    resolveAssistantWorkflowExecutionMode,
    taskBypassesWorkflow,
} = require('./taskExecutionMode')

describe('task execution mode', () => {
    test('keeps the legacy execution-mode defaults', () => {
        expect(getTaskExecutionMode({}, TASK_EXECUTION_MODE_DIRECT)).toBe(TASK_EXECUTION_MODE_DIRECT)
        expect(taskBypassesWorkflow({ executionMode: TASK_EXECUTION_MODE_DIRECT })).toBe(true)
    })

    test('runs directly when workflow mode is requested without a configured first step', () => {
        expect(
            resolveAssistantWorkflowExecutionMode({ uid: 'assistant-1' }, 'project-1', TASK_EXECUTION_MODE_WORKFLOW)
        ).toBe(TASK_EXECUTION_MODE_DIRECT)
        expect(resolveAssistantWorkflowExecutionMode(null, 'project-1', TASK_EXECUTION_MODE_WORKFLOW)).toBe(
            TASK_EXECUTION_MODE_DIRECT
        )
        expect(
            resolveAssistantWorkflowExecutionMode(
                {
                    workflow: {
                        'project-1': {
                            'assistant-start': { reviewerUid: 'assistant-1' },
                        },
                    },
                },
                'project-1',
                TASK_EXECUTION_MODE_WORKFLOW
            )
        ).toBe(TASK_EXECUTION_MODE_DIRECT)
    })

    test('preserves workflow mode when the first step exists', () => {
        const assistant = {
            workflow: {
                'project-1': {
                    'assistant-start': { reviewerUid: 'assistant-1', reviewerType: 'assistant' },
                },
            },
        }

        expect(resolveAssistantWorkflowExecutionMode(assistant, 'project-1', TASK_EXECUTION_MODE_WORKFLOW)).toBe(
            TASK_EXECUTION_MODE_WORKFLOW
        )
    })

    test('preserves an explicit direct request', () => {
        expect(
            resolveAssistantWorkflowExecutionMode({ uid: 'assistant-1' }, 'project-1', TASK_EXECUTION_MODE_DIRECT)
        ).toBe(TASK_EXECUTION_MODE_DIRECT)
    })
})
