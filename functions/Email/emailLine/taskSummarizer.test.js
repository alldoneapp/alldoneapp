const mockCreate = jest.fn()

jest.mock('../../Assistant/assistantHelper', () => ({
    buildOpenAiPromptCacheKey: jest.fn(scope => `${scope}-cache-key`),
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'key' })),
    getModel: jest.fn(() => 'gpt-5.4-nano'),
    getOpenAIClient: jest.fn(() => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } })),
    logOpenAiCacheUsage: jest.fn(),
}))

const { getCachedEnvFunctions, logOpenAiCacheUsage } = require('../../Assistant/assistantHelper')
const { summarizeEmailAsTaskName, parseContinuationPlan, summarizeEmailContinuation } = require('./taskSummarizer')

describe('taskSummarizer', () => {
    beforeEach(() => jest.clearAllMocks())

    test('returns the model title and uses a scoped prompt cache key', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '  Review the launch plan.  ' } }],
            usage: { total_tokens: 42 },
        })

        const result = await summarizeEmailAsTaskName({
            context: { subject: 'Launch', body: 'Please review the plan.' },
            cacheScope: 'user-1:project-1',
        })

        expect(result).toEqual({ name: 'Review the launch plan.', totalTokens: 42, modelKey: 'MODEL_GPT6_LUNA' })
        expect(mockCreate.mock.calls[0][0].prompt_cache_key).toBe('email-summary-cache-key')
        expect(logOpenAiCacheUsage).toHaveBeenCalledWith(
            expect.objectContaining({ route: 'email-task-summarizer', cacheKey: 'email-summary-cache-key' })
        )
    })

    test('throws when the OpenAI key is unavailable', async () => {
        getCachedEnvFunctions.mockReturnValueOnce({})
        await expect(summarizeEmailAsTaskName({ context: {} })).rejects.toThrow(/OpenAI key/)
    })
})

test('accepts concise summaries and explicit supported fields, strips unknown changes', () => {
    expect(
        parseContinuationPlan(
            JSON.stringify({
                summary: 'Changed scope',
                actionUpdate: 'Add the annex',
                name: 'Send annex',
                dueDate: '2026-10-09T14:00:00+02:00',
                priority: 'must_do',
                userId: 'attacker',
                suggestedBy: null,
                projectId: 'elsewhere',
            })
        )
    ).toEqual({
        summary: 'Changed scope',
        actionUpdate: 'Add the annex',
        name: 'Send annex',
        dueDate: Date.parse('2026-10-09T14:00:00+02:00'),
        priority: 'must_do',
    })
})
test.each(['Friday', '2026-10-09', '2026-10-09T14:00:00', 'invalidT00:00Z'])(
    'refuses speculative or timezone-less dates: %s',
    dueDate => {
        expect(
            parseContinuationPlan(JSON.stringify({ summary: 'An update', dueDate, priority: 'urgent', name: '' }))
        ).toEqual({ summary: 'An update' })
    }
)
test('refuses invalid or empty summaries and bounds model output', () => {
    expect(() => parseContinuationPlan('{}')).toThrow('missing')
    expect(() => parseContinuationPlan('Not JSON')).toThrow()
    const plan = parseContinuationPlan(JSON.stringify({ summary: 'x'.repeat(800), actionUpdate: 'x'.repeat(2000) }))
    expect(plan.summary).toHaveLength(600)
    expect(plan.actionUpdate).toHaveLength(1200)
})
test('uses the chosen model with separate untrusted email/task context and returns token usage', async () => {
    mockCreate.mockClear()
    mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"summary":"Confirmed receipt","actionUpdate":""}' } }],
        usage: { total_tokens: 123 },
    })
    const result = await summarizeEmailContinuation({
        context: { body: 'Received' },
        task: { name: 'Send offer', description: 'Keep notes' },
        language: 'de',
        modelKey: 'MODEL_GPT5_4_NANO',
    })
    expect(result).toMatchObject({
        plan: { summary: 'Confirmed receipt', actionUpdate: '' },
        totalTokens: 123,
        modelKey: 'MODEL_GPT5_4_NANO',
    })
    const request = mockCreate.mock.calls[0][0]
    expect(request.messages[0].content).toContain('untrusted data')
    expect(JSON.parse(request.messages[1].content)).toMatchObject({
        task: { name: 'Send offer' },
        email: { body: 'Received' },
        language: 'de',
    })
})
