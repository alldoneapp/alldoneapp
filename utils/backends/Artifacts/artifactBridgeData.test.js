import { runBridgeQuery } from './artifactBridgeData'
import { getDb } from '../firestore'

const mockState = {
    loggedUserProjectsMap: { p1: { name: 'Product', color: '#123456', userIds: ['u1', 'u2'] } },
    projectUsers: { p1: [{ uid: 'u1', displayName: 'Ada', email: 'ada@example.com' }] },
}
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: () => mockState } }))
jest.mock('../firestore', () => ({ getDb: jest.fn(), getLoggedUserAccessReaderId: () => 'u1' }))

// Records each query's clauses and answers with the documents of its collection.
function databaseDouble(docsByCollection) {
    const queries = []
    const collection = path => {
        const clauses = []
        const query = {
            where: (field, op, value) => (clauses.push(['where', field, op, value]), query),
            orderBy: (field, direction) => (clauses.push(['orderBy', field, direction]), query),
            limit: count => (clauses.push(['limit', count]), query),
            get: async () => {
                queries.push({ path, clauses })
                const userFilter = clauses.find(clause => clause[1] === 'userId')
                const docs = (docsByCollection[path] || []).filter(
                    ([, data]) => !userFilter || data.userId === userFilter[3]
                )
                return { docs: docs.map(([id, data]) => ({ id, data: () => data })) }
            },
        }
        return query
    }
    return { db: { collection }, queries }
}

const PUBLIC = { readerIds: [0, 'u1', 'u2'] }
const PRIVATE = { readerIds: ['u1'] }

describe('runBridgeQuery', () => {
    it('describes the project and its members without their e-mail addresses', async () => {
        await expect(runBridgeQuery('p1', { name: 'project', params: {} })).resolves.toEqual({
            id: 'p1',
            name: 'Product',
            color: '#123456',
        })
        await expect(runBridgeQuery('p1', { name: 'members', params: {} })).resolves.toEqual([
            { id: 'u1', name: 'Ada' },
        ])
    })

    it('reads open tasks with the indexed query and hands on only project-shared ones', async () => {
        const { db, queries } = databaseDouble({
            'items/p1/tasks': [
                ['t1', { ...PUBLIC, name: 'Shared', done: false }],
                ['t2', { ...PRIVATE, name: 'Mine only', done: false }],
            ],
        })
        getDb.mockReturnValue(db)
        const tasks = await runBridgeQuery('p1', { name: 'tasks', params: { status: 'open', limit: 50 } })
        expect(tasks.map(task => task.title)).toEqual(['Shared'])
        expect(queries[0].clauses).toEqual([
            ['where', 'readerIds', 'array-contains', 'u1'],
            ['where', 'done', '==', false],
            ['where', 'parentId', '==', null],
            ['orderBy', 'dueDate', 'asc'],
            ['limit', 50],
        ])
    })

    it('reads done tasks per member, newest first, within the requested window', async () => {
        const { db, queries } = databaseDouble({
            'items/p1/tasks': [
                ['a', { ...PUBLIC, name: 'A', done: true, userId: 'u1', completed: 10 }],
                ['b', { ...PUBLIC, name: 'B', done: true, userId: 'u2', completed: 30 }],
                ['c', { ...PRIVATE, name: 'C', done: true, userId: 'u2', completed: 20 }],
            ],
        })
        getDb.mockReturnValue(db)
        const now = 100 * 24 * 60 * 60 * 1000
        const tasks = await runBridgeQuery(
            'p1',
            { name: 'tasks', params: { status: 'done', limit: 10, sinceDays: 7 } },
            { now }
        )
        expect(tasks.map(task => task.id)).toEqual(['b', 'a'])
        expect(queries).toHaveLength(2)
        expect(queries[1].clauses).toEqual([
            ['where', 'readerIds', 'array-contains', 'u1'],
            ['where', 'done', '==', true],
            ['where', 'parentId', '==', null],
            ['where', 'userId', '==', 'u2'],
            ['where', 'completed', '>=', now - 7 * 24 * 60 * 60 * 1000],
            ['orderBy', 'completed', 'desc'],
            ['limit', 10],
        ])
    })

    it('reads project-shared goals', async () => {
        const { db } = databaseDouble({
            'goals/p1/items': [
                ['g1', { ...PUBLIC, extendedName: 'Launch', progress: 50 }],
                ['g2', { ...PRIVATE, extendedName: 'Private', progress: 10 }],
            ],
        })
        getDb.mockReturnValue(db)
        const goals = await runBridgeQuery('p1', { name: 'goals', params: {} })
        expect(goals).toEqual([expect.objectContaining({ id: 'g1', title: 'Launch', progress: 50 })])
    })
})
