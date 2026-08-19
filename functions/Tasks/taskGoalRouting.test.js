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
    getModel: jest.fn(() => 'gpt-5.6-luna'),
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
    isGoalEligibleForTaskRouting,
    normalizeClassificationResult,
    normalizeTaskGoalRoutingMode,
    routeNewTaskToGoal,
    selectCandidateGoals,
} = require('./taskGoalRouting')

const createSnapshot = (id, data) => ({
    id,
    exists: data !== undefined,
    data: () => data,
})

const createDb = ({
    mode = TASK_GOAL_ROUTING_SUGGESTIONS,
    goals: suppliedGoals,
    milestones: suppliedMilestones,
} = {}) => {
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
        goals: suppliedGoals || {
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
        milestones: suppliedMilestones || {},
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
    const createQuery = (path, filters = [], order = null, resultLimit = null) => ({
        path,
        where: (field, operator, value) =>
            createQuery(path, [...filters, { field, operator, value }], order, resultLimit),
        orderBy: (field, direction) => createQuery(path, filters, { field, direction }, resultLimit),
        limit: limit => createQuery(path, filters, order, limit),
        get: async () => {
            const entries =
                path === 'goals/project1/items'
                    ? Object.entries(state.goals)
                    : path === 'goalsMilestones/project1/milestonesItems'
                      ? Object.entries(state.milestones)
                      : []
            let results = entries.filter(([, value]) =>
                filters.every(filter => filter.operator === '==' && value[filter.field] === filter.value)
            )
            if (order) {
                results.sort(([, a], [, b]) => {
                    const comparison = Number(a[order.field] || 0) - Number(b[order.field] || 0)
                    return order.direction === 'desc' ? -comparison : comparison
                })
            }
            if (resultLimit !== null) results = results.slice(0, resultLimit)
            return {
                docs: results.map(([id, value]) => createSnapshot(id, value)),
            }
        },
    })
    const db = {
        doc,
        collection: path => {
            const query = createQuery(path)
            return {
                ...query,
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

    test('uses fixed and dynamic completion plus current-milestone semantics for eligibility', () => {
        const currentMilestone = { date: 100 }

        expect(
            isGoalEligibleForTaskRouting(
                {
                    progress: 100,
                    startingMilestoneDate: 50,
                    completionMilestoneDate: 150,
                },
                currentMilestone
            )
        ).toBe(false)
        expect(
            isGoalEligibleForTaskRouting(
                {
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 100,
                    startingMilestoneDate: 50,
                    completionMilestoneDate: 150,
                },
                currentMilestone
            )
        ).toBe(true)
        expect(
            isGoalEligibleForTaskRouting(
                {
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 100,
                    startingMilestoneDate: 10,
                    completionMilestoneDate: 50,
                },
                currentMilestone
            )
        ).toBe(false)
        expect(
            isGoalEligibleForTaskRouting(
                {
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 60,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 100,
                    parentDoneMilestoneIds: ['historical-milestone'],
                },
                currentMilestone
            )
        ).toBe(true)
    })

    test('filters completed goals while preserving current and rolled-forward dynamic goals', async () => {
        const { db, state } = createDb({
            goals: {
                fixedDone: {
                    name: 'Fixed done',
                    ownerId: 'ALL_USERS',
                    progress: 100,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 100,
                    isPublicFor: [0],
                },
                dynamicDonePast: {
                    name: 'Dynamic done in the past',
                    ownerId: 'ALL_USERS',
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 100,
                    startingMilestoneDate: 50,
                    completionMilestoneDate: 50,
                    isPublicFor: [0],
                },
                dynamicDoneCurrent: {
                    name: 'Dynamic done in current milestone',
                    ownerId: 'ALL_USERS',
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 100,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 100,
                    isPublicFor: [0],
                },
                dynamicRolledForward: {
                    name: 'Dynamic active after historical milestone',
                    ownerId: 'ALL_USERS',
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 40,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 100,
                    parentDoneMilestoneIds: ['done-milestone'],
                    isPublicFor: [0],
                },
            },
            milestones: {
                current: {
                    ownerId: 'ALL_USERS',
                    done: false,
                    date: 100,
                },
            },
        })
        let candidateIds = []

        await routeNewTaskToGoal({
            task: state.tasks.task1,
            projectId: 'project1',
            db,
            classify: async ({ goals }) => {
                candidateIds = goals.map(goal => goal.id)
                return {
                    result: {
                        goalId: null,
                        confidence: 0,
                        alternativeGoalId: null,
                        alternativeConfidence: 0,
                        reason: '',
                    },
                    totalTokens: 10,
                }
            },
        })

        expect(candidateIds).toEqual(expect.arrayContaining(['dynamicDoneCurrent', 'dynamicRolledForward']))
        expect(candidateIds).not.toEqual(expect.arrayContaining(['fixedDone', 'dynamicDonePast']))
    })

    test('preselects a relevant goal beyond the former alphabetical 30-goal window', () => {
        const alphabeticallyEarlierGoals = Array.from({ length: 30 }, (_, index) => ({
            id: `goal-${index}`,
            name: `Alpha operational goal ${index}`,
            description: 'Routine internal process',
            lastEditionDate: 1000 - index,
        }))
        const relevantGoal = {
            id: 'goal-z',
            name: 'Improve customer retention',
            description: 'Keep existing customers engaged',
            lastEditionDate: 1,
        }

        const candidates = selectCandidateGoals(
            { name: 'Launch customer retention program' },
            [...alphabeticallyEarlierGoals, relevantGoal],
            null
        )

        expect(candidates).toHaveLength(30)
        expect(candidates[0].id).toBe('goal-z')
        expect(candidates.map(goal => goal.id)).toContain('goal-z')
    })

    test.each(['pending', 'classifying'])(
        'resets a stale %s suggestion and routes the moved task against destination goals',
        async status => {
            const { db, state } = createDb()
            state.tasks.task1.goalSuggestion = {
                goalId: 'old-project-goal',
                status,
                projectId: 'old-project',
                claimId: 'old-claim',
            }
            const classify = jest.fn(async ({ goals }) => ({
                result: {
                    goalId: 'goal1',
                    confidence: 0.94,
                    alternativeGoalId: 'goal2',
                    alternativeConfidence: 0.4,
                    reason: 'Matches a destination goal.',
                },
                totalTokens: 100,
            }))

            const result = await routeNewTaskToGoal({
                task: state.tasks.task1,
                projectId: 'project1',
                db,
                now: 1000,
                classify,
            })

            expect(result.action).toBe('suggest')
            expect(classify.mock.calls[0][0].goals.map(goal => goal.id)).toEqual(['goal1', 'goal2'])
            expect(state.tasks.task1.goalSuggestion).toEqual(
                expect.objectContaining({
                    goalId: 'goal1',
                    status: 'pending',
                    projectId: 'project1',
                    claimId: 'claim1',
                })
            )
            expect(state.tasks.task1.goalSuggestion.goalId).not.toBe('old-project-goal')
        }
    )

    test('does not rerun an unresolved suggestion that already belongs to the current project', async () => {
        const { db, state } = createDb()
        const currentSuggestion = {
            goalId: 'goal1',
            status: 'pending',
            projectId: 'project1',
            claimId: 'current-claim',
        }
        state.tasks.task1.goalSuggestion = currentSuggestion
        const classify = jest.fn()

        const result = await routeNewTaskToGoal({
            task: state.tasks.task1,
            projectId: 'project1',
            db,
            classify,
        })

        expect(result.action).toBe('skipped')
        expect(classify).not.toHaveBeenCalled()
        expect(state.tasks.task1.goalSuggestion).toEqual(currentSuggestion)
    })

    test('does not clear a destination claim when a stale create event is retried', async () => {
        const { db, state } = createDb()
        const destinationClaim = {
            status: 'classifying',
            projectId: 'project1',
            claimId: 'destination-claim',
        }
        state.tasks.task1.goalSuggestion = destinationClaim
        const staleEventTask = {
            ...state.tasks.task1,
            goalSuggestion: {
                goalId: 'old-project-goal',
                status: 'pending',
                projectId: 'old-project',
                claimId: 'old-claim',
            },
        }
        const classify = jest.fn()

        const result = await routeNewTaskToGoal({
            task: staleEventTask,
            projectId: 'project1',
            db,
            classify,
        })

        expect(result.action).toBe('skipped')
        expect(classify).not.toHaveBeenCalled()
        expect(state.tasks.task1.goalSuggestion).toEqual(destinationClaim)
    })

    test.each(['none', 'dismissed', 'failed', 'superseded'])(
        'does not rerun resolved %s routing state after a project move',
        async status => {
            const { db, state } = createDb()
            const resolvedSuggestion = {
                goalId: 'old-project-goal',
                status,
                projectId: 'old-project',
                claimId: 'old-claim',
            }
            state.tasks.task1.goalSuggestion = resolvedSuggestion
            const classify = jest.fn()

            const result = await routeNewTaskToGoal({
                task: state.tasks.task1,
                projectId: 'project1',
                db,
                classify,
            })

            expect(result.action).toBe('skipped')
            expect(classify).not.toHaveBeenCalled()
            expect(state.tasks.task1.goalSuggestion).toEqual(resolvedSuggestion)
        }
    )

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

    test('transaction guard supersedes a goal that becomes dynamically completed outside the current milestone', async () => {
        const { db, state } = createDb({
            mode: TASK_GOAL_ROUTING_AUTOMATIC,
            goals: {
                goal1: {
                    name: 'Improve onboarding',
                    ownerId: 'ALL_USERS',
                    progress: 'DYNAMIC_PERCENT',
                    dynamicProgress: 50,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 100,
                    isPublicFor: [0],
                },
            },
            milestones: {
                current: {
                    ownerId: 'ALL_USERS',
                    done: false,
                    date: 100,
                },
            },
        })

        const result = await routeNewTaskToGoal({
            task: state.tasks.task1,
            projectId: 'project1',
            db,
            classify: async () => {
                state.goals.goal1.dynamicProgress = 100
                state.goals.goal1.startingMilestoneDate = 50
                state.goals.goal1.completionMilestoneDate = 50
                return {
                    result: {
                        goalId: 'goal1',
                        confidence: 0.96,
                        alternativeGoalId: null,
                        alternativeConfidence: 0,
                        reason: 'Direct match.',
                    },
                    totalTokens: 100,
                }
            },
        })

        expect(result.action).toBe('superseded')
        expect(state.tasks.task1.parentGoalId).toBeNull()
        expect(state.tasks.task1.goalSuggestion).toEqual(
            expect.objectContaining({
                status: 'superseded',
                reason: 'goal_unavailable',
            })
        )
        expect(state.undoActions).toEqual({})
    })
})
