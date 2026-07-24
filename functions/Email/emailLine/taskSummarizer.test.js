const mockCreate = jest.fn()

jest.mock('../../Assistant/assistantHelper', () => ({
    buildOpenAiPromptCacheKey: jest.fn(scope => `${scope}-cache-key`),
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'key' })),
    getOpenAIClient: jest.fn(() => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } })),
    logOpenAiCacheUsage: jest.fn(),
}))

const { getCachedEnvFunctions, logOpenAiCacheUsage } = require('../../Assistant/assistantHelper')
const { summarizeEmailAsTaskName } = require('./taskSummarizer')

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

        expect(result).toEqual({ name: 'Review the launch plan.', totalTokens: 42 })
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
