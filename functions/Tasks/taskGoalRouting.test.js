'use strict'

const mockResponsesCreate = jest.fn()
const mockDeductGold = jest.fn()
const mockAddGoalRoutingReasonComment = jest.fn()
const mockCreateTaskParentGoalChangedFeed = jest.fn()
const mockFeedCommit = jest.fn()
const mockLoadFeedsGlobalState = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))
jest.mock('../Assistant/assistantHelper', () => ({
    calculateGoldCostFromTokens: jest.fn(() => 1),
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'test-key' })),
    getOpenAIClient: jest.fn(() => ({
        responses: { create: mockResponsesCreate },
    })),
}))
jest.mock('../Gold/goldHelper', () => ({
    deductGold: (...args) => mockDeductGold(...args),
}))
jest.mock('../shared/UndoActionService', () => ({
    createUndoActionRecord: data => data,
}))
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addGoalRoutingReasonComment: (...args) => mockAddGoalRoutingReasonComment(...args),
}))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: class {
        setProjectContext() {}
        commit() {
            return mockFeedCommit()
        }
    },
}))
jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskParentGoalChangedFeed: (...args) => mockCreateTaskParentGoalChangedFeed(...args),
}))
jest.mock('../Feeds/tasksFeedsHelper', () => ({
    generateTaskObjectModel: (lastChangeDate, task, taskId) => ({ id: taskId, ...task, lastChangeDate }),
}))
jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: (...args) => mockLoadFeedsGlobalState(...args),
}))

const {
    TASK_GOAL_ROUTING_AUTOMATIC,
    TASK_GOAL_ROUTING_SUGGESTIONS,
    chooseRoutingAction,
    classifyTaskAgainstGoals,
    normalizeClassificationResult,
    normalizeTaskGoalRoutingMode,
    routeNewTaskToGoal,
} = require('./taskGoalRouting')

const createSnapshot = (id, data) => ({
    id,
    exists: data !== undefined,
    data: () => data,
})

const createDb = ({ mode = TASK_GOAL_ROUTING_SUGGESTIONS } = {}) => {
    const state = {
        projects: {
            project1: {
                taskGoalRoutingMode: mode,
                userIds: ['user1'],
            },
        },
        users: {
            user1: { gold: 10 },
        },
        tasks: {
            task1: {
                id: 'task1',
                name: 'Ship onboarding',
                creatorId: 'user1',
                parentGoalId: null,
                lockKey: '',
            },
        },
        goals: {
            goal1: {
                name: 'Improve onboarding',
                description: 'Reduce time to value',
                ownerId: 'ALL_USERS',
                progress: 20,
                isPublicFor: [0],
                lockKey: 'goal-lock',
            },
            goal2: {
                name: 'Grow revenue',
                ownerId: 'ALL_USERS',
                progress: 10,
                isPublicFor: [0],
            },
        },
        undoActions: {},
    }

    const resolve = path => {
        const parts = path.split('/')
        if (parts[0] === 'projects') return state.projects[parts[1]]
        if (parts[0] === 'users' && parts[2] !== 'undoActions') return state.users[parts[1]]
        if (parts[0] === 'items') return state.tasks[parts[3]]
        if (parts[0] === 'goals') return state.goals[parts[3]]
        if (parts[0] === 'users' && parts[2] === 'undoActions') return state.undoActions[parts[3]]
        return undefined
    }
    const assign = (path, value) => {
        const parts = path.split('/')
        if (parts[0] === 'items') state.tasks[parts[3]] = { ...state.tasks[parts[3]], ...value }
        if (parts[0] === 'users' && parts[2] === 'undoActions') state.undoActions[parts[3]] = value
    }
    const doc = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => createSnapshot(path.split('/').pop(), resolve(path)),
        update: async value => assign(path, value),
    })
    const db = {
        doc,
        collection: path => {
            if (path === 'goals/project1/items') {
                return {
                    where: () => ({
                        get: async () => ({
                            docs: Object.entries(state.goals).map(([id, goal]) => createSnapshot(id, goal)),
                        }),
                    }),
                }
            }
            return {
                doc: () => doc(`${path}/${path.startsWith('_taskGoalRoutingClaims') ? 'claim1' : 'undo1'}`),
            }
        },
        runTransaction: async callback =>
            callback({
                get: ref => ref.get(),
                update: (ref, value) => assign(ref.path, value),
                set: (ref, value) => assign(ref.path, value),
            }),
    }
    return { db, state }
}

describe('taskGoalRouting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDeductGold.mockResolvedValue({ success: true })
        mockAddGoalRoutingReasonComment.mockResolvedValue({ assistantId: 'assistant1' })
        mockCreateTaskParentGoalChangedFeed.mockResolvedValue()
        mockFeedCommit.mockResolvedValue()
    })

    test('rejects invented goal IDs and uses the confidence margin for auto assignment', () => {
        expect(normalizeTaskGoalRoutingMode(undefined)).toBe(TASK_GOAL_ROUTING_AUTOMATIC)

        expect(
            normalizeClassificationResult(
                {
                    goalId: 'invented',
                    confidence: 0.99,
                    alternativeGoalId: 'goal2',
                    alternativeConfidence: 0.1,
                },
                ['goal1', 'goal2']
            )
        ).toEqual(
            expect.objectContaining({
                goalId: null,
                confidence: 0,
            })
        )

        expect(
            chooseRoutingAction(TASK_GOAL_ROUTING_AUTOMATIC, {
                goalId: 'goal1',
                confidence: 0.92,
                alternativeConfidence: 0.8,
            })
        ).toBe('suggest')
        expect(
            chooseRoutingAction(TASK_GOAL_ROUTING_AUTOMATIC, {
                goalId: 'goal1',
                confidence: 0.92,
                alternativeConfidence: 0.5,
            })
        ).toBe('auto_assign')
    })

    test('calls Luna with low reasoning and a strict structured output schema', async () => {
        mockResponsesCreate.mockResolvedValue({
            output_text: JSON.stringify({
                goalId: 'goal1',
                confidence: 0.8,
                alternativeGoalId: null,
                alternativeConfidence: 0,
                reason: 'Directly advances onboarding.',
            }),
            usage: { total_tokens: 123 },
        })

        const result = await classifyTaskAgainstGoals({
            task: { name: 'Ship onboarding' },
            goals: [{ id: 'goal1', name: 'Improve onboarding' }],
            userId: 'user1',
        })

        expect(result.totalTokens).toBe(123)
        expect(mockResponsesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-5.6-luna',
                reasoning: { effort: 'low' },
                text: expect.objectContaining({
                    format: expect.objectContaining({
                        type: 'json_schema',
                        strict: true,
                    }),
                }),
            })
        )
    })

    test('stores a pending suggestion without moving the task in suggestion mode', async () => {
        const { db, state } = createDb()
        const result = await routeNewTaskToGoal({
            task: state.tasks.task1,
            projectId: 'project1',
            db,
            now: 1000,
            classify: async () => ({
                result: {
                    goalId: 'goal1',
                    confidence: 0.94,
                    alternativeGoalId: 'goal2',
                    alternativeConfidence: 0.4,
                    reason: 'Direct match.',
                },
                totalTokens: 100,
            }),
        })

        expect(result.action).toBe('suggest')
        expect(state.tasks.task1.parentGoalId).toBeNull()
        expect(state.tasks.task1.goalSuggestion).toEqual(
            expect.objectContaining({
                goalId: 'goal1',
                status: 'pending',
                model: 'gpt-5.6-luna',
            })
        )
        expect(mockDeductGold).toHaveBeenCalledWith(
            'user1',
            1,
            expect.objectContaining({ source: 'task_goal_routing' })
        )
        expect(mockAddGoalRoutingReasonComment).not.toHaveBeenCalled()
        expect(mockCreateTaskParentGoalChangedFeed).not.toHaveBeenCalled()
    })

    test('auto-assigns only a high-confidence match and creates an undo action', async () => {
        const { db, state } = createDb({ mode: TASK_GOAL_ROUTING_AUTOMATIC })
        const result = await routeNewTaskToGoal({
            task: state.tasks.task1,
            projectId: 'project1',
            db,
            now: 1000,
            classify: async () => ({
                result: {
                    goalId: 'goal1',
                    confidence: 0.95,
                    alternativeGoalId: 'goal2',
                    alternativeConfidence: 0.4,
                    reason: 'Direct match.',
                },
                totalTokens: 100,
            }),
        })

        expect(result.action).toBe('auto_assign')
        expect(state.tasks.task1).toEqual(
            expect.objectContaining({
                parentGoalId: 'goal1',
                parentGoalIsPublicFor: [0],
                lockKey: 'goal-lock',
                goalSuggestion: expect.objectContaining({ status: 'auto_assigned' }),
            })
        )
        expect(state.undoActions.undo1.operations[0]).toEqual(
            expect.objectContaining({
                objectType: 'task',
                projectId: 'project1',
                objectId: 'task1',
                before: expect.objectContaining({
                    'goalSuggestion.status': 'dismissed',
                }),
                after: expect.objectContaining({
                    'goalSuggestion.status': 'auto_assigned',
                }),
            })
        )
        expect(state.undoActions.undo1.operations[0].after.goalSuggestion).toBeUndefined()
        expect(mockAddGoalRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project1',
                taskId: 'task1',
                goalId: 'goal1',
                confidence: 0.95,
                commentId: 'goal-routing-claim1',
            })
        )
        expect(mockCreateTaskParentGoalChangedFeed).toHaveBeenCalledWith(
            'project1',
            'goal1',
            null,
            'task1',
            true,
            expect.anything(),
            expect.objectContaining({ uid: 'assistant1' }),
            true,
            { feedId: 'goal-routing-claim1' }
        )
        expect(mockFeedCommit).toHaveBeenCalledTimes(1)
    })
})
