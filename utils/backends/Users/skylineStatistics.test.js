import moment from 'moment'

const mockQueries = []
const mockFail = { next: false }

jest.mock('../firestore', () => ({
    getDb: () => ({
        collection: path => {
            const query = { path, filters: [] }
            const chain = {
                where: (field, op, value) => {
                    query.filters.push([field, op, value])
                    return chain
                },
                get: () => {
                    mockQueries.push(query)
                    if (mockFail.next) {
                        mockFail.next = false
                        return Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' }))
                    }
                    const from = query.filters[0][2]
                    const docs = [{ day: from, doneTasks: 3, doneTime: 20 }]
                    return Promise.resolve({ forEach: callback => docs.forEach(data => callback({ data: () => data })) })
                },
            }
            return chain
        },
    }),
}))

const { loadSkylineStatistics, __resetSkylineStatisticsCache } = require('./skylineStatistics')

const TODAY = moment('2026-09-25T10:00:00').valueOf()
const START = moment('2025-09-22').toDate()

describe('loadSkylineStatistics', () => {
    beforeEach(() => {
        mockQueries.length = 0
        mockFail.next = false
        __resetSkylineStatisticsCache()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('reads the past once per session and only re-reads today', async () => {
        await loadSkylineStatistics('u1', ['p1'], START, TODAY)
        expect(mockQueries).toHaveLength(2)
        expect(mockQueries[0].path).toBe('statistics/p1/u1')

        await loadSkylineStatistics('u1', ['p1'], START, TODAY)
        expect(mockQueries).toHaveLength(3)
        expect(mockQueries[2].filters).toEqual([
            ['day', '>=', 20260925],
            ['day', '<=', 20260925],
        ])
    })

    it('maps documents by day', async () => {
        const result = await loadSkylineStatistics('u1', ['p1'], START, TODAY)
        expect(result.p1[20250922]).toEqual({ doneTasks: 3, doneTime: 20 })
    })

    it('does not remember a failed past read', async () => {
        mockFail.next = true
        const first = await loadSkylineStatistics('u1', ['p1'], START, TODAY)
        expect(first.p1[20250922]).toBeUndefined()

        await loadSkylineStatistics('u1', ['p1'], START, TODAY)
        const pastReads = mockQueries.filter(query => query.filters[0][2] === 20250922)
        expect(pastReads).toHaveLength(2)
    })

    it('reads nothing without a user or projects', async () => {
        expect(await loadSkylineStatistics('', ['p1'], START, TODAY)).toEqual({})
        expect(await loadSkylineStatistics('u1', [], START, TODAY)).toEqual({})
        expect(mockQueries).toHaveLength(0)
    })
})
