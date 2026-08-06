import {
    buildRejectedAssistantSuggestedTask,
    getSuggestedById,
    getAssistantSuggestedTaskRejection,
    isAssistantSuggestedTask,
    resolveSuggestedByIdentity,
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

    test('uses suggestedBy as the canonical identity and keeps legacy fallbacks', () => {
        expect(getSuggestedById(assistantSuggestion)).toBe('assistant-1')
        expect(
            getSuggestedById({
                creatorId: 'user-1',
                taskMetadata: { assistantSuggestion: { assistantId: 'assistant-2' } },
            })
        ).toBe('assistant-2')
        expect(getSuggestedById({ creatorId: 'user-1' })).toBe('user-1')
    })

    test('resolves an assistant suggestion from the assistant record', () => {
        const assistant = { uid: 'assistant-1', displayName: 'Anna Alldone', photoURL50: 'anna.jpg' }

        expect(resolveSuggestedByIdentity({ task: assistantSuggestion, assistant })).toEqual({
            id: 'assistant-1',
            identity: assistant,
            isAssistant: true,
        })
    })

    test('recognizes a missing assistant from persisted suggestion metadata', () => {
        expect(resolveSuggestedByIdentity({ task: assistantSuggestion })).toEqual({
            id: 'assistant-1',
            identity: null,
            isAssistant: true,
        })
    })

    test('preserves human and unknown suggestion identity behavior', () => {
        const user = { uid: 'user-2', displayName: 'Karsten Wysk' }
        const humanSuggestion = {
            ...assistantSuggestion,
            suggestedBy: 'user-2',
            creatorId: 'user-2',
            taskMetadata: null,
        }

        expect(resolveSuggestedByIdentity({ task: humanSuggestion, user })).toEqual({
            id: 'user-2',
            identity: user,
            isAssistant: false,
        })
        expect(resolveSuggestedByIdentity({ task: humanSuggestion, suggestedById: 'deleted-user' })).toEqual({
            id: 'deleted-user',
            identity: null,
            isAssistant: false,
        })
    })
})
