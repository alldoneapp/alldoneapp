'use strict'

const mockCompletionCreate = jest.fn()
const mockCreateCalendarLearnedRuleFeed = jest.fn()
const mockTransactionSet = jest.fn()
const mockConfigRef = {
    path: 'users/user-1/private/calendarProjectRouting_calendar-project',
}
const mockFeedbackRef = {
    path: `${mockConfigRef.path}/feedback/feedback-1`,
    set: jest.fn(async data => {
        mockFeedbackState = { ...(mockFeedbackState || {}), ...data }
    }),
}
mockConfigRef.collection = jest.fn(() => ({ doc: jest.fn(() => mockFeedbackRef) }))

let mockFeedbackState
let mockConfigState

const mockDb = {
    doc: jest.fn(path => ({ path })),
    getAll: jest.fn(),
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
    const buildKey = (provider, recurringEventId) =>
        crypto.createHash('sha256').update(`${provider}:${recurringEventId}`).digest('hex').slice(0, 32)
    return {
        buildCalendarProjectDefinitions: jest.fn(projects =>
            projects.map(project => ({ projectId: project.id, name: project.name }))
        ),
        buildCalendarSeriesRouteKey: jest.fn(buildKey),
        loadActiveProjectsForCalendarRouting: jest.fn(() => Promise.resolve([{ id: 'project-a', name: 'Project A' }])),
        loadCalendarProjectRoutingConfig: jest.fn(() =>
            Promise.resolve({ exists: true, config: { ...mockConfigState }, ref: mockConfigRef })
        ),
        normalizeLearnedSeriesRoutes: jest.fn(routes => routes || {}),
    }
})

const {
    appendDeterministicCalendarFeedbackRule,
    buildUpdatedSeriesRoutes,
    captureCalendarProjectRoutingFeedback,
} = require('./calendarProjectRoutingFeedback')

const movedTask = {
    id: 'event-instance-2',
    name: 'Weekly Acme status',
    description: 'Client status meeting',
    lastEditorId: 'user-1',
    calendarData: {
        email: 'me@example.com',
        provider: 'google',
        recurringEventId: 'series-1',
        originalProjectId: 'calendar-project',
        projectRouting: {
            chosenProjectId: 'wrong-project',
            reasoning: 'The previous classifier picked this project.',
        },
        projectRoutingFeedback: {
            feedbackId: 'feedback-1',
            requestedByUserId: 'user-1',
            requestedAt: 123,
            syncProjectId: 'calendar-project',
            movedFromProjectId: 'wrong-project',
            movedToProjectId: 'project-a',
        },
    },
}

describe('calendarProjectRoutingFeedback', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFeedbackState = null
        mockConfigState = {
            enabled: true,
            learnedRules: '- Existing rule',
            learnedRulesRevision: 2,
            learnedSeriesRoutes: {},
        }
        mockDb.getAll.mockResolvedValue([
            {
                exists: true,
                data: () => ({ premium: { status: 'premium' }, projectIds: ['project-a'] }),
            },
            {
                id: 'project-a',
                exists: true,
                data: () => ({ name: 'Project A', active: true }),
            },
        ])
        mockCompletionCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            learnedRules: '- Weekly Acme status meetings route to Project A (project ID: "project-a").',
                        }),
                    },
                },
            ],
            usage: { total_tokens: 100 },
        })
        mockCreateCalendarLearnedRuleFeed.mockResolvedValue({
            feedId: 'calendar-learned-rule-feedback-1',
        })
    })

    test('commits generalized rules and an exact recurring-series route atomically', async () => {
        const result = await captureCalendarProjectRoutingFeedback({
            task: movedTask,
            taskProjectId: 'project-a',
        })

        expect(result).toEqual(
            expect.objectContaining({ status: 'completed', learnedSeriesRouteApplied: true, alreadyApplied: false })
        )
        expect(mockCompletionCreate).toHaveBeenCalledTimes(1)
        expect(mockTransactionSet).toHaveBeenCalledWith(
            mockConfigRef,
            expect.objectContaining({
                learnedRulesRevision: 3,
                learnedRules: expect.stringContaining('Weekly Acme status'),
                learnedSeriesRoutes: expect.any(Object),
            })
        )
        expect(Object.values(mockConfigState.learnedSeriesRoutes)).toContainEqual(
            expect.objectContaining({ recurringEventId: 'series-1', targetProjectId: 'project-a' })
        )
        expect(mockFeedbackState).toEqual(expect.objectContaining({ status: 'completed' }))
        expect(mockCreateCalendarLearnedRuleFeed).toHaveBeenCalledWith(
            expect.objectContaining({
                feedbackId: 'feedback-1',
                projectId: 'project-a',
                ruleType: 'project',
            })
        )
        expect(mockFeedbackState).toEqual(
            expect.objectContaining({
                feedId: 'calendar-learned-rule-feedback-1',
                feedCreatedAt: 'timestamp-now',
                learnedRuleCreated: true,
            })
        )
    })

    test('is idempotent when the same move feedback is delivered again', async () => {
        mockFeedbackState = { status: 'completed' }

        const result = await captureCalendarProjectRoutingFeedback({
            task: movedTask,
            taskProjectId: 'project-a',
        })

        expect(result).toEqual({ status: 'completed', alreadyApplied: true })
        expect(mockCompletionCreate).not.toHaveBeenCalled()
        expect(mockCreateCalendarLearnedRuleFeed).not.toHaveBeenCalled()
    })

    test('retries a missing deterministic feed without revising completed rules again', async () => {
        mockFeedbackState = { status: 'completed', learnedRuleCreated: true }

        const result = await captureCalendarProjectRoutingFeedback({
            task: movedTask,
            taskProjectId: 'project-a',
        })

        expect(result).toEqual({ status: 'completed', alreadyApplied: true })
        expect(mockCompletionCreate).not.toHaveBeenCalled()
        expect(mockCreateCalendarLearnedRuleFeed).toHaveBeenCalledTimes(1)
        expect(mockFeedbackState.feedCreatedAt).toBe('timestamp-now')
    })

    test('does not create a feed when feedback leaves the learned rules unchanged', async () => {
        mockCompletionCreate.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ learnedRules: '- Existing rule' }) } }],
            usage: { total_tokens: 50 },
        })

        const result = await captureCalendarProjectRoutingFeedback({
            task: movedTask,
            taskProjectId: 'project-a',
        })

        expect(result).toEqual(expect.objectContaining({ status: 'completed', feedCreated: false }))
        expect(mockCreateCalendarLearnedRuleFeed).not.toHaveBeenCalled()
        expect(mockFeedbackState.learnedRuleCreated).toBe(false)
    })

    test('has a deterministic fallback that keeps learning available during a model outage', () => {
        expect(
            appendDeterministicCalendarFeedbackRule('- Existing rule', {
                event: { summary: 'Weekly Acme status', recurringEventId: 'series-1' },
                targetProject: { projectId: 'project-a', name: 'Project A' },
            })
        ).toBe(
            '- Route occurrences of the recurring calendar event "Weekly Acme status" to "Project A" (project ID: "project-a").\n- Existing rule'
        )
    })

    test('does not create an exact mapping for a non-recurring event', () => {
        expect(
            buildUpdatedSeriesRoutes(
                { learnedSeriesRoutes: {} },
                { summary: 'One-off meeting', provider: 'google' },
                { projectId: 'project-a', name: 'Project A' },
                'feedback-1',
                123
            )
        ).toEqual({})
    })
})
