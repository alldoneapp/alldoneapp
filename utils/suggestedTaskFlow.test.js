import {
    buildRejectedAssistantSuggestedTask,
    getAssistantSuggestedTaskRejection,
    isAssistantSuggestedTask,
} from './suggestedTaskFlow'

describe('assistant suggested task flow', () => {
    const assistantSuggestion = {
        id: 'task-1',
        userId: 'user-1',
        userIds: ['user-1'],
        currentReviewerId: 'user-1',
        assistantId: '',
        suggestedBy: 'assistant-1',
        assigneeType: 'USER',
        taskMetadata: { assistantSuggestion: { assistantId: 'assistant-1' } },
    }

    test('reassigns a rejected assistant suggestion to the assistant', () => {
        expect(isAssistantSuggestedTask(assistantSuggestion)).toBe(true)
        expect(buildRejectedAssistantSuggestedTask(assistantSuggestion)).toEqual({
            ...assistantSuggestion,
            userId: 'assistant-1',
            userIds: ['assistant-1'],
            currentReviewerId: 'assistant-1',
            assigneeType: 'ASSISTANT',
            assistantId: 'assistant-1',
        })
        expect(getAssistantSuggestedTaskRejection(assistantSuggestion)).toEqual({
            task: expect.objectContaining({
                userId: 'assistant-1',
                userIds: ['assistant-1'],
                assigneeType: 'ASSISTANT',
            }),
            targetStepId: -2,
            commentType: 'STAYWARD_COMMENT',
        })
    })

    test('does not change a task suggested by another human', () => {
        const humanSuggestion = {
            ...assistantSuggestion,
            assistantId: '',
            suggestedBy: 'user-2',
            creatorId: 'user-2',
            taskMetadata: null,
        }

        expect(isAssistantSuggestedTask(humanSuggestion)).toBe(false)
        expect(buildRejectedAssistantSuggestedTask(humanSuggestion)).toBeNull()
        expect(getAssistantSuggestedTaskRejection(humanSuggestion)).toBeNull()
    })
})
