'use strict'

// Security audit 2026-11 (reduceGoldWhenChatWithAI:stale-capped-posthoc-charge): an assistant run
// was billed min(cost, balance read when the run STARTED) through an all-or-nothing deduct whose
// failure was ignored. It is now billed its full cost through settleUsageGold, which caps at the
// balance at charge time and reports what it could not cover.

const mockSettleUsageGold = jest.fn(async (userId, cost) => ({ success: true, amount: cost, uncovered: 0 }))
jest.mock('../Gold/goldHelper', () => ({
    settleUsageGold: (...args) => mockSettleUsageGold(...args),
    deductGold: jest.fn(async () => {
        throw new Error('assistant usage must be settled, not deducted')
    }),
}))

const { reduceGoldWhenChatWithAI } = require('./assistantHelper')

beforeEach(() => mockSettleUsageGold.mockClear())

test('bills the full cost even when the balance read at run start was smaller', async () => {
    const answer = 'word '.repeat(5000)
    const staleBalance = 3

    await reduceGoldWhenChatWithAI('user-1', staleBalance, 'MODEL_GPT5_6_SOL', answer, [['system', 'be brief']], null, {
        projectId: 'p1',
        objectId: 'o1',
        objectType: 'topics',
    })

    expect(mockSettleUsageGold).toHaveBeenCalledTimes(1)
    const [userId, cost, context] = mockSettleUsageGold.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(cost).toBeGreaterThan(staleBalance)
    expect(context).toMatchObject({
        source: 'assistant_usage',
        projectId: 'p1',
        objectId: 'o1',
        model: 'MODEL_GPT5_6_SOL',
    })
})

test('returns the settlement, so a shortfall is visible to the caller', async () => {
    mockSettleUsageGold.mockResolvedValueOnce({ success: true, amount: 1, uncovered: 40 })

    const result = await reduceGoldWhenChatWithAI('user-1', 1, 'MODEL_GPT5_6_SOL', 'hello '.repeat(2000), [])

    expect(result).toMatchObject({ amount: 1, uncovered: 40 })
})
