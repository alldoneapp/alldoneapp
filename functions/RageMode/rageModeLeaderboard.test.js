const mockDocs = new Map()

const mockRef = path => ({
    path,
    get: jest.fn(async () => {
        const data = mockDocs.get(path)
        return { exists: data !== undefined, id: path.split('/').pop(), data: () => data }
    }),
    set: jest.fn(async (update, options) => {
        const current = options && options.merge ? mockDocs.get(path) || {} : {}
        mockDocs.set(path, { ...current, ...update })
    }),
})

// Just enough of a Firestore query for the board: where / orderBy / limit / count.
const mockQuery = (collection, filters = [], order = null, max = Infinity) => {
    const run = () => {
        let rows = [...mockDocs.entries()]
            .filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2)
            .map(([path, data]) => ({ id: path.split('/')[1], data }))
            .filter(({ data }) =>
                filters.every(({ field, op, value }) => {
                    const actual = data[field]
                    if (actual === undefined) return false
                    if (op === '>') return actual > value
                    if (op === '==') return actual === value
                    throw new Error(`unsupported op ${op}`)
                })
            )
        if (order) {
            rows = rows.filter(({ data }) => data[order.field] !== undefined)
            rows.sort((a, b) => (order.dir === 'desc' ? -1 : 1) * (a.data[order.field] - b.data[order.field]))
        }
        return rows.slice(0, max)
    }
    return {
        where: (field, op, value) => mockQuery(collection, [...filters, { field, op, value }], order, max),
        orderBy: (field, dir = 'asc') => mockQuery(collection, filters, { field, dir }, max),
        limit: n => mockQuery(collection, filters, order, n),
        count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
        get: async () => ({ docs: run().map(row => ({ id: row.id, exists: true, data: () => row.data })) }),
    }
}

jest.mock('firebase-admin', () => {
    const refs = new Map()
    const doc = path => {
        if (!refs.has(path)) refs.set(path, mockRef(path))
        return refs.get(path)
    }
    return {
        firestore: () => ({
            doc,
            collection: name => mockQuery(name),
            runTransaction: async fn =>
                fn({
                    get: ref => ref.get(),
                    set: (ref, update, options) => ref.set(update, options),
                }),
        }),
    }
})
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { arrayUnion: (...items) => ({ __arrayUnion: items }) } }))
jest.mock('../Gold/goldHelper', () => ({ deductGold: jest.fn() }))

const { defaultName, getRageModeLeaderboard, sanitizeName, setRageModeName } = require('./rageModeLeaderboard')
const { submitRageModeScore } = require('./rageModeProfile')

const play = async (userId, score, final = true) => submitRageModeScore({ userId, score, final })

describe('rage mode leaderboard', () => {
    beforeEach(() => mockDocs.clear())

    it('never shows a real name by default: an anonymous pilot number, stable per user', () => {
        expect(defaultName('u1')).toMatch(/^Pilot \d{4}$/)
        expect(defaultName('u1')).toBe(defaultName('u1'))
        expect(defaultName('u1')).not.toBe(defaultName('u2'))
    })

    it('accepts readable names and nothing that can carry links, markup or mentions', () => {
        expect(sanitizeName('  Karsten   W.  ')).toBe('Karsten W.')
        expect(sanitizeName('Zoë_99')).toBe('Zoë_99')
        expect(sanitizeName("O'Brien-2")).toBe("O'Brien-2")
        ;['a', 'x'.repeat(21), '<b>hi</b>', 'see https://x.y', '@everyone', '!!!', '', null, 42].forEach(bad =>
            expect(sanitizeName(bad)).toBeNull()
        )
    })

    it('puts the best score on the board and ranks everyone, sharing a rank on a tie', async () => {
        await play('a', 900)
        await play('b', 1500)
        await play('c', 900)
        await play('d', 300)
        await play('a', 100)
        const board = await getRageModeLeaderboard({ userId: 'd' })
        expect(board.top.map(row => [row.rank, row.score])).toEqual([
            [1, 1500],
            [2, 900],
            [2, 900],
            [4, 300],
        ])
        expect(board.you).toEqual({ rank: 4, name: defaultName('d'), score: 300 })
        expect(board.top.find(row => row.you).score).toBe(300)
        expect(board.total).toBe(4)
        expect(board.nameChosen).toBe(false)
    })

    it('shows only the top five, and still tells you your rank below them', async () => {
        for (let i = 1; i <= 8; i++) await play(`p${i}`, i * 100)
        const board = await getRageModeLeaderboard({ userId: 'p1' })
        expect(board.top).toHaveLength(5)
        expect(board.top[0].score).toBe(800)
        expect(board.top.some(row => row.you)).toBe(false)
        expect(board.you).toMatchObject({ rank: 8, score: 100 })
    })

    it('has no rank for someone who has not scored yet', async () => {
        await play('a', 500)
        expect((await getRageModeLeaderboard({ userId: 'new' })).you).toBeNull()
    })

    it('shows the chosen name, on the board and for later scores', async () => {
        await play('a', 500)
        expect(await setRageModeName({ userId: 'a', name: '  Anna Fan ' })).toEqual({ ok: true, name: 'Anna Fan' })
        let board = await getRageModeLeaderboard({ userId: 'a' })
        expect(board.top[0].name).toBe('Anna Fan')
        expect(board).toMatchObject({ name: 'Anna Fan', nameChosen: true })
        await setRageModeName({ userId: 'b', name: 'Bea' })
        await play('b', 700)
        board = await getRageModeLeaderboard({ userId: 'b' })
        expect(board.top[0]).toMatchObject({ name: 'Bea', score: 700, you: true })
        expect(await setRageModeName({ userId: 'a', name: '<script>' })).toEqual({ ok: false, reason: 'invalid_name' })
    })

    it('lets a mid-run score set a best without counting a finished game', async () => {
        await play('a', 400, false)
        expect((await getRageModeLeaderboard({ userId: 'a' })).you).toMatchObject({ score: 400 })
        expect(mockDocs.get('rageModeProfiles/a').games).toBeUndefined()
        await play('a', 200)
        expect(mockDocs.get('rageModeProfiles/a').games).toBe(1)
    })

    it('carries a best score from before the board existed onto it', async () => {
        mockDocs.set('rageModeProfiles/old', { highscore: 2000, games: 9 })
        await play('old', 10)
        expect((await getRageModeLeaderboard({ userId: 'old' })).you).toMatchObject({ rank: 1, score: 2000 })
    })
})
