'use strict'

// AT-3126 (Karsten, 2026-11-23): an assistant's web_search costs Gold, at cost, per executed search.
// A failed search costs nothing.

jest.mock('../shared/ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase-admin', () => {
    const firestore = { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) }
    return { firestore: jest.fn(() => firestore) }
})
jest.mock('openai', () => jest.fn())
jest.mock('@dqbd/tiktoken/lite', () => ({
    Tiktoken: jest.fn().mockImplementation(() => ({ encode: jest.fn(() => []), free: jest.fn() })),
}))
jest.mock('@dqbd/tiktoken/encoders/cl100k_base.json', () => ({ bpe_ranks: {}, special_tokens: {}, pat_str: '' }))
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: jest.fn(() => '') })) }))
jest.mock('./assistantModelRuntime', () => ({
    ...jest.requireActual('./assistantModelRuntime'),
    getCachedEnvFunctions: () => ({ TAVILY_API_KEY: 'tvly-test' }),
}))

const mockSearch = jest.fn()
jest.mock('@tavily/core', () => ({ tavily: () => ({ search: (...args) => mockSearch(...args) }) }))
const mockSettleUsageGold = jest.fn(async () => ({ success: true, amount: 20 }))
jest.mock('../Gold/goldHelper', () => ({ settleUsageGold: (...args) => mockSettleUsageGold(...args) }))

const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
const { executeToolNatively } = require('./assistantHelper')
const { WEB_SEARCH_GOLD, WEB_SEARCH_GOLD_SOURCE } = require('./webSearchPricing')

afterAll(() => consoleLogSpy.mockRestore())

describe('web_search costs Gold', () => {
    beforeEach(() => jest.clearAllMocks())

    test('one executed search is billed at cost to the member the run acts for', async () => {
        mockSearch.mockResolvedValue({
            answer: 'a',
            results: [{ title: 't', url: 'https://example.com', content: 'c' }],
        })

        const result = await executeToolNatively(
            'web_search',
            { query: 'MCP authorization' },
            'project-1',
            'anna',
            'user-1',
            {},
            { objectType: 'topics', objectId: 'chat-1' }
        )

        expect(result).toMatchObject({ success: true, results: [{ url: 'https://example.com' }] })
        expect(WEB_SEARCH_GOLD).toBe(20)
        expect(mockSettleUsageGold).toHaveBeenCalledWith('user-1', WEB_SEARCH_GOLD, {
            source: WEB_SEARCH_GOLD_SOURCE,
            channel: 'assistant',
            projectId: 'project-1',
            objectId: 'chat-1',
            objectType: 'topics',
        })
    })

    test('a failed search costs nothing', async () => {
        mockSearch.mockRejectedValue(new Error('429'))
        const result = await executeToolNatively('web_search', { query: 'x' }, 'project-1', 'anna', 'user-1', {}, {})
        expect(result).toMatchObject({ success: false })
        expect(mockSettleUsageGold).not.toHaveBeenCalled()
    })

    test('a billing failure never takes the result away', async () => {
        mockSearch.mockResolvedValue({ results: [] })
        mockSettleUsageGold.mockRejectedValueOnce(new Error('firestore down'))
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const result = await executeToolNatively('web_search', { query: 'x' }, 'project-1', 'anna', 'user-1', {}, {})
        expect(result).toMatchObject({ success: true })
        errorSpy.mockRestore()
    })
})
