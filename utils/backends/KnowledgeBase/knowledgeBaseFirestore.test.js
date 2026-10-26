// An in-memory Firestore, just enough for the reads behind a wiki page's recent changes (AT-2878):
// documents by path, and a revisions collection ordered and filtered the way the queries ask.
const mockDocs = new Map()
const mockReads = []

function mockQuery(path, { filters = [], order = null, limit = null } = {}) {
    return {
        where: (field, op, value) => mockQuery(path, { filters: [...filters, { field, op, value }], order, limit }),
        orderBy: (field, direction = 'asc') => mockQuery(path, { filters, order: { field, direction }, limit }),
        limit: count => mockQuery(path, { filters, order, limit: count }),
        get: async () => {
            mockReads.push({ collection: path, filters, order, limit })
            let docs = [...mockDocs.entries()]
                .filter(([docPath]) => docPath.startsWith(`${path}/`) && !docPath.slice(path.length + 1).includes('/'))
                .map(([docPath, data]) => ({ id: docPath.split('/').pop(), data: () => data }))
            filters.forEach(({ field, op, value }) => {
                if (op === '<') docs = docs.filter(doc => doc.data()[field] < value)
            })
            if (order) {
                const sign = order.direction === 'desc' ? -1 : 1
                docs.sort((a, b) => sign * (a.data()[order.field] - b.data()[order.field]))
            }
            if (limit) docs = docs.slice(0, limit)
            return { empty: docs.length === 0, docs }
        },
    }
}

jest.mock('../firestore', () => ({
    getDb: () => ({
        collection: path => mockQuery(path),
        doc: path => ({
            get: async () => {
                mockReads.push({ doc: path })
                return { exists: mockDocs.has(path), data: () => mockDocs.get(path) }
            },
        }),
    }),
    runHttpsCallableFunction: jest.fn(),
}))

import { getKnowledgePageRange, getKnowledgeRevisionNumberBefore } from './knowledgeBaseFirestore'

const PAGE = 'knowledgeBases/p1/pages/kunden'
const revisionPath = number => `${PAGE}/revisions/${String(number).padStart(6, '0')}`

function seed(count) {
    mockDocs.set(PAGE, { title: 'Kunden', body: `Stand ${count}`, revision: count, updatedAt: 1000 * count })
    for (let number = 1; number <= count; number++) {
        mockDocs.set(revisionPath(number), { revision: number, body: `Stand ${number}`, createdAt: 1000 * number })
    }
}

beforeEach(() => {
    mockDocs.clear()
    mockReads.length = 0
})

describe('reading what a wiki page changed since one of its revisions', () => {
    it('takes the newest revision and a recent base from the latest revisions it reads anyway', async () => {
        seed(5)
        const result = await getKnowledgePageRange('p1', 'kunden', 3)

        expect(result.page).toMatchObject({ slug: 'kunden', revision: 5 })
        expect(result.latest).toMatchObject({ revision: 5, body: 'Stand 5' })
        expect(result.base).toMatchObject({ revision: 3, body: 'Stand 3' })
        expect(result.revisions.map(item => item.revision)).toEqual([5, 4, 3, 2, 1])
        // The page and one revisions query, no single revision reads.
        expect(mockReads.filter(read => read.doc)).toEqual([{ doc: PAGE }])
    })

    it('reads a base further back than the loaded revisions on its own', async () => {
        seed(25)
        const result = await getKnowledgePageRange('p1', 'kunden', 2)

        expect(result.revisions).toHaveLength(20)
        expect(result.base).toMatchObject({ id: '000002', revision: 2, body: 'Stand 2' })
        expect(mockReads.filter(read => read.doc).map(read => read.doc)).toEqual([PAGE, revisionPath(2)])
    })

    it('reads no base for the page before it existed, nor one that is not older than the newest', async () => {
        seed(3)
        expect((await getKnowledgePageRange('p1', 'kunden', 0)).base).toBeNull()
        expect((await getKnowledgePageRange('p1', 'kunden', 3)).base).toBeNull()
    })

    it('reads nothing for an invalid base', async () => {
        seed(3)
        expect(await getKnowledgePageRange('p1', 'kunden', -1)).toBeNull()
        expect(await getKnowledgePageRange('p1', 'kunden', 1.5)).toBeNull()
        expect(mockReads).toHaveLength(0)
    })

    it('finds the newest revision made before a time, and 0 when the page did not exist yet', async () => {
        seed(5)
        expect(await getKnowledgeRevisionNumberBefore('p1', 'kunden', 3500)).toBe(3)
        expect(await getKnowledgeRevisionNumberBefore('p1', 'kunden', 500)).toBe(0)
        expect(mockReads[0]).toMatchObject({
            collection: `${PAGE}/revisions`,
            filters: [{ field: 'createdAt', op: '<', value: 3500 }],
            order: { field: 'createdAt', direction: 'desc' },
            limit: 1,
        })
    })
})
