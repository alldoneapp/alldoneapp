'use strict'

const mockCompletionCreate = jest.fn()
const mockCreateCalendarLearnedRuleFeed = jest.fn()
const mockTransactionSet = jest.fn()
const mockConfigRef = {
    path: 'users/user-1/private/calendarProjectRouting_calendar-project',
}
const mockFeedbackRef = {
    path: `${mockConfigRef.path}/goalFeedback/goal-feedback-1`,
    set: jest.fn(async data => {
        mockFeedbackState = { ...(mockFeedbackState || {}), ...data }
    }),
}
mockConfigRef.collection = jest.fn(() => ({ doc: jest.fn(() => mockFeedbackRef) }))

let mockFeedbackState
let mockConfigState

const snapshot = (id, data) => ({ id, exists: data !== undefined, data: () => data || {} })
const mockDb = {
    doc: jest.fn(path => ({ path, id: path.split('/').pop() })),
    getAll: jest.fn(async (...refs) =>
        refs.map(ref => {
            if (ref.path === 'users/user-1') {
                return snapshot('user-1', { premium: { status: 'premium' }, projectIds: ['project-a'] })
            }
            if (ref.path === 'projects/project-a') {
                return snapshot('project-a', { name: 'Project A', active: true })
            }
            if (ref.path === 'goals/project-a/items/goal-a') {
                return snapshot('goal-a', { name: 'Client delivery' })
            }
            if (ref.path === 'goals/project-a/items/goal-old') {
                return snapshot('goal-old', { name: 'Old Goal' })
            }
            return snapshot(ref.id, undefined)
        })
    ),
    runTransaction: jest.fn(async callback =>
        callback({
            get: jest.fn(async ref => {
                if (ref === mockFeedbackRef) {
                    return { exists: !!mockFeedbackState, data: () => mockFeedbackState || {} }
                }
                if (ref === mockConfigRef) {
                    return { exists: true, data: () => mockConfigState }
                }
                return { exists: false, data: () => ({}) }
            }),
            set: (ref, data) => {
                mockTransactionSet(ref, data)
                if (ref === mockFeedbackRef) mockFeedbackState = { ...(mockFeedbackState || {}), ...data }
                if (ref === mockConfigRef) mockConfigState = { ...mockConfigState, ...data }
            },
        })
    ),
}

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => mockDb),
}))

jest.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: jest.fn(() => 'timestamp-now') },
}))

jest.mock('../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'openai-key' })),
    getOpenAIClient: jest.fn(() => ({ chat: { completions: { create: mockCompletionCreate } } })),
    logOpenAiCacheUsage: jest.fn(),
}))

jest.mock('../Gmail/gmailPromptClassifier', () => ({
    extractJsonFromText: jest.fn(text => JSON.parse(text)),
    isGpt5ReasoningModel: jest.fn(() => true),
    mapAssistantModelToOpenAIModel: jest.fn(() => 'gpt-5.6-sol'),
}))

jest.mock('./calendarLearnedRuleFeed', () => ({
    createCalendarLearnedRuleFeed: mockCreateCalendarLearnedRuleFeed,
}))

jest.mock('./calendarProjectRoutingConfig', () => {
    const crypto = require('crypto')
    return {
        buildCalendarGoalSeriesRouteKey: jest.fn((provider, recurringEventId, projectId) =>
            crypto
                .createHash('sha256')
                .update(`${provider}:${recurringEventId}:${projectId}`)
                .digest('hex')
                .slice(0, 32)
        ),
        loadCalendarProjectRoutingConfig: jest.fn(() =>
            Promise.resolve({ exists: true, config: { ...mockConfigState }, ref: mockConfigRef })
        ),
        normalizeLearnedGoalSeriesRoutes: jest.fn(routes => routes || {}),
    }
})

const {
    appendDeterministicCalendarGoalFeedbackRule,
    buildUpdatedGoalSeriesRoutes,
    captureCalendarGoalRoutingFeedback,
    normalizeGoalFeedbackMarker,
} = require('./calendarGoalRoutingFeedback')

const calendarTask = ({ selectedGoalId = 'goal-a', previousGoalId = null } = {}) => ({
    id: 'event-instance-2',
    name: 'Weekly Acme status',
    description: 'Client status meeting',
    lastEditorId: 'user-1',
    parentGoalId: selectedGoalId,
    calendarData: {
        email: 'me@example.com',
        provider: 'google',
        recurringEventId: 'series-1',
        originalProjectId: 'calendar-project',
        goalRoutingFeedback: {
            feedbackId: 'goal-feedback-1',
            requestedByUserId: 'user-1',
            requestedAt: 123,
            syncProjectId: 'calendar-project',
            projectId: 'project-a',
            previousGoalId,
            selectedGoalId,
        },
    },
})

describe('calendarGoalRoutingFeedback', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFeedbackState = null
        mockConfigState = {
            enabled: true,
            learnedGoalRules: '- Existing Goal rule',
            learnedGoalRulesRevision: 2,
            learnedGoalSeriesRoutes: {},
        }
        mockCompletionCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            learnedGoalRules:
                                '- Weekly Acme status meetings go to Client delivery (Goal ID: "goal-a").',
                        }),
                    },
                },
            ],
            usage: { total_tokens: 100 },
        })
        mockCreateCalendarLearnedRuleFeed.mockResolvedValue({
            feedId: 'calendar-learned-rule-goal-feedback-1',
        })
    })

    test('commits generalized Goal rules and an exact recurring Goal assignment atomically', async () => {
        const result = await captureCalendarGoalRoutingFeedback({
            task: calendarTask(),
            previousTask: { parentGoalId: null },
            taskProjectId: 'project-a',
        })

        expect(result).toEqual(
            expect.objectContaining({
                status: 'completed',
                learnedGoalSeriesRouteApplied: true,
                alreadyApplied: false,
            })
        )
        expect(mockCompletionCreate).toHaveBeenCalledTimes(1)
        expect(mockTransactionSet).toHaveBeenCalledWith(
            mockConfigRef,
            expect.objectContaining({
                learnedGoalRulesRevision: 3,
                learnedGoalRules: expect.stringContaining('Client delivery'),
                learnedGoalSeriesRoutes: expect.any(Object),
            })
        )
        expect(Object.values(mockConfigState.learnedGoalSeriesRoutes)).toContainEqual(
            expect.objectContaining({
                recurringEventId: 'series-1',
                projectId: 'project-a',
                targetGoalId: 'goal-a',
                routeToNoGoal: false,
            })
        )
        expect(mockCreateCalendarLearnedRuleFeed).toHaveBeenCalledWith(
            expect.objectContaining({
                feedbackId: 'goal-feedback-1',
                projectId: 'project-a',
                ruleType: 'goal',
                selectedGoal: { goalId: 'goal-a', name: 'Client delivery' },
            })
        )
        expect(mockFeedbackState).toEqual(
            expect.objectContaining({
                feedId: 'calendar-learned-rule-goal-feedback-1',
                feedCreatedAt: 'timestamp-now',
                learnedRuleCreated: true,
            })
        )
    })

    test('stores an explicit recurring no-Goal choice', async () => {
        mockCompletionCreate.mockResolvedValue({
            choices: [
                { message: { content: JSON.stringify({ learnedGoalRules: '- Leave this series without a Goal.' }) } },
            ],
            usage: { total_tokens: 50 },
        })
        const task = calendarTask({ selectedGoalId: null, previousGoalId: 'goal-old' })

        const result = await captureCalendarGoalRoutingFeedback({
            task,
            previousTask: { parentGoalId: 'goal-old' },
            taskProjectId: 'project-a',
        })

        expect(result.status).toBe('completed')
        expect(Object.values(mockConfigState.learnedGoalSeriesRoutes)).toContainEqual(
            expect.objectContaining({
                projectId: 'project-a',
                targetGoalId: '',
                routeToNoGoal: true,
            })
        )
    })

    test('is idempotent when the same Goal feedback is delivered again', async () => {
        mockFeedbackState = { status: 'completed' }

        const result = await captureCalendarGoalRoutingFeedback({
            task: calendarTask(),
            previousTask: { parentGoalId: null },
            taskProjectId: 'project-a',
        })

        expect(result).toEqual({ status: 'completed', alreadyApplied: true })
        expect(mockCompletionCreate).not.toHaveBeenCalled()
        expect(mockCreateCalendarLearnedRuleFeed).not.toHaveBeenCalled()
    })

    test('retries a missing Goal-rule feed without revising completed rules again', async () => {
        mockFeedbackState = { status: 'completed', learnedRuleCreated: true }

        const result = await captureCalendarGoalRoutingFeedback({
            task: calendarTask(),
            previousTask: { parentGoalId: null },
            taskProjectId: 'project-a',
        })

        expect(result).toEqual({ status: 'completed', alreadyApplied: true })
        expect(mockCompletionCreate).not.toHaveBeenCalled()
        expect(mockCreateCalendarLearnedRuleFeed).toHaveBeenCalledTimes(1)
        expect(mockFeedbackState.feedCreatedAt).toBe('timestamp-now')
    })

    test('does not create a feed when feedback leaves the learned Goal rules unchanged', async () => {
        mockCompletionCreate.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ learnedGoalRules: '- Existing Goal rule' }) } }],
            usage: { total_tokens: 50 },
        })

        const result = await captureCalendarGoalRoutingFeedback({
            task: calendarTask(),
            previousTask: { parentGoalId: null },
            taskProjectId: 'project-a',
        })

        expect(result).toEqual(expect.objectContaining({ status: 'completed', feedCreated: false }))
        expect(mockCreateCalendarLearnedRuleFeed).not.toHaveBeenCalled()
        expect(mockFeedbackState.learnedRuleCreated).toBe(false)
    })

    test('rejects a marker that claims a different user than the task editor', () => {
        const task = calendarTask()
        task.lastEditorId = 'different-user'

        expect(normalizeGoalFeedbackMarker(task, 'project-a')).toBeNull()
    })

    test('has a deterministic removal fallback', () => {
        expect(
            appendDeterministicCalendarGoalFeedbackRule('- Existing rule', {
                event: { summary: 'Weekly Acme status', recurringEventId: 'series-1' },
                project: { projectId: 'project-a', name: 'Project A' },
                selectedGoal: null,
            })
        ).toBe(
            '- In project "Project A" (project ID: "project-a"), leave occurrences of the recurring calendar event "Weekly Acme status" without a Goal.\n- Existing rule'
        )
    })

    test('does not create an exact mapping for a non-recurring event', () => {
        expect(
            buildUpdatedGoalSeriesRoutes(
                { learnedGoalSeriesRoutes: {} },
                { summary: 'One-off meeting', provider: 'google' },
                { projectId: 'project-a', name: 'Project A' },
                { goalId: 'goal-a', name: 'Client delivery' },
                'goal-feedback-1',
                123
            )
        ).toEqual({})
    })
})
