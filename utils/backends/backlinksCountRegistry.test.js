import {
    BACKLINK_TOKENS_PER_QUERY,
    IDLE_SHRINK_MS,
    REBUILD_DEBOUNCE_MS,
    resetBacklinksCountRegistryForTests,
    subscribeBacklinksCount,
} from './backlinksCountRegistry'

const createContext = () => {
    const queries = []
    const context = {
        readerKey: 'u1',
        readerField: { read: data => data.tokens || [] },
        acceptTask: data => data.parentId === null && data.visible !== false,
        acceptNote: data => data.visible !== false,
        mapAlone: (collection, doc) => ({ collection, id: doc.id }),
        subscribe: jest.fn((collection, tokens, onDocs, onError) => {
            const query = { collection, tokens, onDocs, onError, closed: false }
            queries.push(query)
            return () => (query.closed = true)
        }),
        onError: jest.fn(),
    }
    const open = collection => queries.filter(query => !query.closed && query.collection === collection)
    const answer = (collection, docs) =>
        open(collection).forEach(query =>
            query.onDocs(docs.map(([id, data]) => ({ id, data: () => ({ parentId: null, ...data }) })))
        )
    return { context, queries, open, answer }
}

describe('backlinksCountRegistry', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        resetBacklinksCountRegistryForTests()
    })
    afterEach(() => {
        resetBacklinksCountRegistryForTests()
        jest.useRealTimers()
    })

    it('answers every object of a project from one tasks and one notes query', () => {
        const { context, open, answer } = createContext()
        const a = jest.fn()
        const b = jest.fn()
        subscribeBacklinksCount('p1', 'A', a, context)
        subscribeBacklinksCount('p1', 'B', b, context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)

        expect(open('tasks')).toHaveLength(1)
        expect(open('notes')).toHaveLength(1)
        expect(open('tasks')[0].tokens).toEqual(['A', 'B'])

        answer('tasks', [
            ['t1', { tokens: ['A'] }],
            ['t2', { tokens: ['A', 'B'] }],
            ['sub', { tokens: ['B'], parentId: 'x' }],
            ['private', { tokens: ['B'], visible: false }],
        ])
        answer('notes', [['n1', { tokens: ['B'] }]])

        expect(a).toHaveBeenCalledWith('tasks', 2, null)
        expect(a).toHaveBeenCalledWith('notes', 0, null)
        // Subtasks and objects the reader cannot see are not counted, as before.
        expect(b).toHaveBeenCalledWith('tasks', 1, { collection: 'tasks', id: 't2' })
        expect(b).toHaveBeenCalledWith('notes', 1, { collection: 'notes', id: 'n1' })
    })

    it('splits more objects than one query can carry', () => {
        const { context, open } = createContext()
        for (let index = 0; index < BACKLINK_TOKENS_PER_QUERY + 1; index++)
            subscribeBacklinksCount('p1', `T${String(index).padStart(2, '0')}`, jest.fn(), context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)

        expect(open('tasks').map(query => query.tokens.length)).toEqual([BACKLINK_TOKENS_PER_QUERY, 1])
    })

    it('serves a second consumer of a known object without a new query, and does not rebuild on removal', () => {
        const { context, queries, open, answer } = createContext()
        const first = jest.fn()
        const unsubscribeA = subscribeBacklinksCount('p1', 'A', first, context)
        subscribeBacklinksCount('p1', 'B', jest.fn(), context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)
        answer('tasks', [['t1', { tokens: ['A'] }]])
        answer('notes', [])
        const queryCount = queries.length

        const second = jest.fn()
        subscribeBacklinksCount('p1', 'A', second, context)
        expect(second).toHaveBeenCalledWith('tasks', 1, { collection: 'tasks', id: 't1' })
        expect(queries).toHaveLength(queryCount)

        // Scrolling a row away must not rebuild the query at once...
        unsubscribeA()
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)
        expect(queries).toHaveLength(queryCount)
        // ...only once the project has been idle for a while.
        jest.advanceTimersByTime(IDLE_SHRINK_MS)
        expect(queries).toHaveLength(queryCount)
    })

    it('shrinks the query after idling once an object is gone for good', () => {
        const { context, queries, open } = createContext()
        const unsubscribeA = subscribeBacklinksCount('p1', 'A', jest.fn(), context)
        const unsubscribeA2 = subscribeBacklinksCount('p1', 'A', jest.fn(), context)
        subscribeBacklinksCount('p1', 'B', jest.fn(), context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)
        unsubscribeA()
        unsubscribeA2()

        jest.advanceTimersByTime(IDLE_SHRINK_MS)

        expect(open('tasks')[0].tokens).toEqual(['B'])
        expect(queries.filter(query => query.closed)).toHaveLength(2)
    })

    it('closes everything when the last object of a project goes', () => {
        const { context, open } = createContext()
        const unsubscribe = subscribeBacklinksCount('p1', 'A', jest.fn(), context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)
        unsubscribe()

        expect(open('tasks')).toHaveLength(0)
        expect(open('notes')).toHaveLength(0)
    })

    it('reports zero on a failed query, like the per-object listeners did', () => {
        const { context, open } = createContext()
        const callback = jest.fn()
        subscribeBacklinksCount('p1', 'A', callback, context)
        jest.advanceTimersByTime(REBUILD_DEBOUNCE_MS)

        open('tasks')[0].onError(new Error('denied'))
        open('notes')[0].onDocs([])

        expect(context.onError).toHaveBeenCalledWith('tasks', expect.any(Error))
        expect(callback).toHaveBeenCalledWith('tasks', 0, null)
    })
})
