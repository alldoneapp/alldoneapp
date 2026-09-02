const { mapWithConcurrency } = require('./mapWithConcurrency')

describe('mapWithConcurrency', () => {
    test('returns results in input order and never exceeds the limit', async () => {
        let inFlight = 0
        let peak = 0
        const results = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async value => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise(resolve => setTimeout(resolve, value))
            inFlight--
            return value * 10
        })
        expect(results).toEqual([50, 10, 40, 20, 30])
        expect(peak).toBe(2)
    })

    test('accepts any iterable and an oversized limit', async () => {
        const results = await mapWithConcurrency(new Set(['a', 'b']), 50, async (value, index) => `${index}:${value}`)
        expect(results).toEqual(['0:a', '1:b'])
    })

    test('resolves to an empty array for no items', async () => {
        await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([])
    })

    test('rejects when a call rejects', async () => {
        await expect(
            mapWithConcurrency([1, 2], 2, async value => {
                if (value === 2) throw new Error('boom')
                return value
            })
        ).rejects.toThrow('boom')
    })
})
