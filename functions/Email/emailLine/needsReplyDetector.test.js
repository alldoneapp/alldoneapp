const mockCreate = jest.fn()

jest.mock('../../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'key' })),
    getOpenAIClient: jest.fn(() => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } })),
}))

const { getCachedEnvFunctions } = require('../../Assistant/assistantHelper')
const { detectNeedsReply, extractJson } = require('./needsReplyDetector')

const messages = [
    { messageId: 'm1', from: 'a@ex.com', subject: 'Can you review?', snippet: 'Please advise' },
    { messageId: 'm2', from: 'news@promo.com', subject: 'Sale', snippet: 'Buy now' },
]

describe('needsReplyDetector', () => {
    beforeEach(() => jest.clearAllMocks())

    test('extractJson parses fenced and bare json', () => {
        expect(extractJson('```json\n{"needsReply":["a"]}\n```')).toEqual({ needsReply: ['a'] })
        expect(extractJson('noise {"needsReply":["b"]} trailer')).toEqual({ needsReply: ['b'] })
        expect(extractJson('not json')).toBeNull()
    })

    test('returns empty without messages or key', async () => {
        expect(await detectNeedsReply([])).toEqual({ flagsByMessageId: {}, totalTokens: 0 })
        getCachedEnvFunctions.mockReturnValueOnce({})
        expect(await detectNeedsReply(messages)).toEqual({ flagsByMessageId: {}, totalTokens: 0 })
    })

    test('flags only ids the model returns and that exist', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '{"needsReply":["m1","ghost"]}' } }],
            usage: { total_tokens: 42 },
        })
        const result = await detectNeedsReply(messages)
        expect(result.flagsByMessageId).toEqual({ m1: true })
        expect(result.totalTokens).toBe(42)
    })

    test('malformed model output flags nothing and never throws', async () => {
        mockCreate.mockResolvedValue({ choices: [{ message: { content: 'garbage' } }], usage: { total_tokens: 10 } })
        const result = await detectNeedsReply(messages)
        expect(result.flagsByMessageId).toEqual({})
        expect(result.totalTokens).toBe(10)
    })

    test('LLM error is swallowed', async () => {
        mockCreate.mockRejectedValue(new Error('boom'))
        expect(await detectNeedsReply(messages)).toEqual({ flagsByMessageId: {}, totalTokens: 0 })
    })
})
