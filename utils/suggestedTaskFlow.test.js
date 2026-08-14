import {
    buildRejectedAssistantSuggestedTask,
    collectSuggestedTasks,
    getSuggestedById,
    getAssistantSuggestedTaskRejection,
    isAssistantSuggestedTask,
    resolveSuggestedByIdentity,
    resolveSuggestedRejectionStepId,
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

describe('bulk suggested task selection', () => {
    const suggestedTask = (id, suggestedBy) => ({ id, suggestedBy, creatorId: suggestedBy })

    test('flattens the goal groups a suggested section renders', () => {
        const taskByGoalsList = [
            ['no-goal', [suggestedTask('task-1', 'assistant-1'), suggestedTask('task-2', 'assistant-1')]],
            ['goal-1', [suggestedTask('task-3', 'assistant-1')]],
        ]

        expect(collectSuggestedTasks(taskByGoalsList, 'assistant-1').map(task => task.id)).toEqual([
            'task-1',
            'task-2',
            'task-3',
        ])
    })

    test('never reaches beyond the section it was pressed in', () => {
        const taskByGoalsList = [
            ['no-goal', [suggestedTask('task-1', 'assistant-1'), suggestedTask('task-2', 'user-9')]],
            ['goal-1', [suggestedTask('task-3', 'assistant-1')]],
        ]

        expect(collectSuggestedTasks(taskByGoalsList, 'assistant-1').map(task => task.id)).toEqual(['task-1', 'task-3'])
    })

    test('deduplicates a task listed under several goal groups', () => {
        const taskByGoalsList = [
            ['no-goal', [suggestedTask('task-1', 'assistant-1')]],
            ['goal-1', [suggestedTask('task-1', 'assistant-1')]],
        ]

        expect(collectSuggestedTasks(taskByGoalsList, 'assistant-1')).toHaveLength(1)
    })

    test('tolerates malformed or empty input', () => {
        expect(collectSuggestedTasks(undefined, 'assistant-1')).toEqual([])
        expect(collectSuggestedTasks([], 'assistant-1')).toEqual([])
        expect(collectSuggestedTasks([['no-goal', null], null, ['goal-1', [null, {}]]], 'assistant-1')).toEqual([])
    })

    test('keeps every task when no suggester is given', () => {
        const taskByGoalsList = [['no-goal', [suggestedTask('task-1', 'assistant-1'), suggestedTask('task-2', 'u-9')]]]

        expect(collectSuggestedTasks(taskByGoalsList).map(task => task.id)).toEqual(['task-1', 'task-2'])
    })
})

describe('bulk rejection target step', () => {
    const sortStepIds = workflow => Object.keys(workflow).sort()

    test('sends the rejection to Done when the reviewer has no workflow', () => {
        expect(resolveSuggestedRejectionStepId(undefined, sortStepIds)).toBe(-2)
        expect(resolveSuggestedRejectionStepId({}, sortStepIds)).toBe(-2)
        expect(resolveSuggestedRejectionStepId(null, sortStepIds)).toBe(-2)
    })

    test('uses the first sorted workflow step when the reviewer has a workflow', () => {
        const workflow = { 'step-b': { reviewerUid: 'user-2' }, 'step-a': { reviewerUid: 'user-1' } }

        expect(resolveSuggestedRejectionStepId(workflow, sortStepIds)).toBe('step-a')
    })

    test('falls back to Done when the workflow cannot be sorted into a first step', () => {
        expect(resolveSuggestedRejectionStepId({ 'step-a': {} }, () => [])).toBe(-2)
        expect(resolveSuggestedRejectionStepId({ 'step-a': {} }, () => null)).toBe(-2)
    })
})
