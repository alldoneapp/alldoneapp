jest.mock('../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(),
    getOpenAIClient: jest.fn(),
    normalizeModelKey: jest.fn(model => model),
}))

const assistantHelper = require('../Assistant/assistantHelper')
const {
    classifyCalendarEventProject,
    coerceCalendarProjectResult,
    normalizeCalendarEventForClassifier,
} = require('./calendarProjectClassifier')

const projectDefinitions = [
    { projectId: 'family-project', name: 'Familie' },
    { projectId: 'juno-project', name: 'JTL Software - Project Juno' },
]

describe('calendarProjectClassifier', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        assistantHelper.getCachedEnvFunctions.mockReturnValue({})
    })

    test('accepts a valid high-confidence project match', () => {
        const result = coerceCalendarProjectResult(
            {
                matched: true,
                projectId: 'juno-project',
                projectName: 'JTL Software - Project Juno',
                confidence: 0.91,
                reasoning: 'Mentions the roadmap team.',
            },
            projectDefinitions,
            0.7
        )

        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                projectId: 'juno-project',
                projectName: 'JTL Software - Project Juno',
                confidence: 0.91,
            })
        )
    })

    test('rejects invalid project ids and low confidence matches', () => {
        expect(
            coerceCalendarProjectResult({ matched: true, projectId: 'invented', confidence: 0.95 }, ['project-a'], 0.7)
        ).toEqual(expect.objectContaining({ matched: false, projectId: null }))

        expect(
            coerceCalendarProjectResult({ matched: true, projectId: 'project-a', confidence: 0.2 }, ['project-a'], 0.7)
        ).toEqual(expect.objectContaining({ matched: false, projectId: null }))
    })

    test('rejects mismatched selected project name', () => {
        const result = coerceCalendarProjectResult(
            {
                matched: true,
                projectId: 'family-project',
                projectName: 'JTL Software - Project Juno',
                confidence: 0.91,
                reasoning: 'Mentions family plans.',
            },
            projectDefinitions,
            0.7
        )

        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                projectId: null,
                reasoning: 'Classifier returned inconsistent project routing details.',
            })
        )
    })

    test('rejects reasoning that names a different project than the selected id', () => {
        const result = coerceCalendarProjectResult(
            {
                matched: true,
                projectId: 'family-project',
                projectName: 'Familie',
                confidence: 0.86,
                reasoning:
                    'The event is a partner conference and JTL Software - Project Juno explicitly mentions Partner Convention preparation.',
            },
            projectDefinitions,
            0.7
        )

        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                projectId: null,
                reasoning: 'Classifier returned inconsistent project routing details.',
            })
        )
    })

    test('normalizes calendar event details for classifier input', () => {
        const event = normalizeCalendarEventForClassifier(
            {
                id: 'event-1',
                summary: 'Product roadmap',
                location: 'Meet',
                attendees: [
                    {
                        email: 'person@example.com',
                        displayName: 'Person',
                        responseStatus: 'accepted',
                        self: true,
                    },
                ],
            },
            'me@example.com'
        )

        expect(event).toEqual(
            expect.objectContaining({
                id: 'event-1',
                summary: 'Product roadmap',
                location: 'Meet',
                calendarEmail: 'me@example.com',
                attendees: [
                    expect.objectContaining({
                        email: 'person@example.com',
                        responseStatus: 'accepted',
                        self: true,
                    }),
                ],
            })
        )
    })

    test('retries once when the first result is inconsistent and accepts the repaired result', async () => {
        const create = jest
            .fn()
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                matched: true,
                                projectId: 'family-project',
                                projectName: 'Familie',
                                confidence: 0.86,
                                reasoning: 'JTL Software - Project Juno mentions partner convention preparation.',
                            }),
                        },
                    },
                ],
                usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 },
            })
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                matched: true,
                                projectId: 'juno-project',
                                projectName: 'JTL Software - Project Juno',
                                confidence: 0.9,
                                reasoning:
                                    'The event is a partner conference and matches Juno partner convention work.',
                            }),
                        },
                    },
                ],
                usage: { total_tokens: 80, prompt_tokens: 65, completion_tokens: 15 },
            })
        assistantHelper.getCachedEnvFunctions.mockReturnValue({ OPEN_AI_KEY: 'key' })
        assistantHelper.getOpenAIClient.mockReturnValue({ chat: { completions: { create } } })

        const result = await classifyCalendarEventProject({
            config: {
                prompt: 'Route events',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
            },
            event: { id: 'event-1', summary: 'Partner Conferenz on Cologne' },
            projectDefinitions,
            calendarEmail: 'me@example.com',
        })

        expect(create).toHaveBeenCalledTimes(2)
        expect(create.mock.calls[1][0].messages[2].content).toContain('previous JSON was inconsistent')
        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                projectId: 'juno-project',
                projectName: 'JTL Software - Project Juno',
                usage: expect.objectContaining({
                    totalTokens: 180,
                    retriedAfterInconsistentResult: true,
                }),
            })
        )
    })

    test('falls back to no match when the retry is still inconsistent', async () => {
        const create = jest
            .fn()
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                matched: true,
                                projectId: 'family-project',
                                projectName: 'Familie',
                                confidence: 0.86,
                                reasoning: 'JTL Software - Project Juno mentions partner convention preparation.',
                            }),
                        },
                    },
                ],
                usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 },
            })
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                matched: true,
                                projectId: 'family-project',
                                projectName: 'Familie',
                                confidence: 0.86,
                                reasoning: 'JTL Software - Project Juno still seems relevant.',
                            }),
                        },
                    },
                ],
                usage: { total_tokens: 80, prompt_tokens: 65, completion_tokens: 15 },
            })
        assistantHelper.getCachedEnvFunctions.mockReturnValue({ OPEN_AI_KEY: 'key' })
        assistantHelper.getOpenAIClient.mockReturnValue({ chat: { completions: { create } } })

        const result = await classifyCalendarEventProject({
            config: {
                prompt: 'Route events',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
            },
            event: { id: 'event-1', summary: 'Partner Conferenz on Cologne' },
            projectDefinitions,
            calendarEmail: 'me@example.com',
        })

        expect(create).toHaveBeenCalledTimes(2)
        expect(result).toEqual(
            expect.objectContaining({
                matched: false,
                projectId: null,
                reasoning: 'Classifier returned inconsistent project routing details.',
            })
        )
    })
})
