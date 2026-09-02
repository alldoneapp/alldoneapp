import { deleteOldVisibleFeeds, isAlreadyGoneDeleteError } from './feedCleanup'

const makeFeedDoc = (id, lastChangeDate) => ({
    id,
    data: () => ({ lastChangeDate }),
})

const permissionDenied = () =>
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

// A db double whose query resolves on demand, so two cleanups can be started
// while the first one is still reading.
const makeDb = ({ docs, deleteResults = {} }) => {
    let resolveQuery
    const get = jest.fn(() => new Promise(resolve => (resolveQuery = () => resolve({ docs }))))
    const where = jest.fn().mockReturnValue({ get })
    const collection = jest.fn().mockReturnValue({ where })
    const remove = jest.fn(path => deleteResults[path] || Promise.resolve(undefined))
    const doc = jest.fn(path => ({ delete: () => remove(path) }))
    return { db: { collection, doc }, get, where, collection, doc, remove, resolveQuery: () => resolveQuery() }
}

describe('deleteOldVisibleFeeds', () => {
    it('uses the access projection and deletes only entries beyond the retained amount', async () => {
        const docs = [makeFeedDoc('oldest', 1), makeFeedDoc('newest', 3), makeFeedDoc('middle', 2)]
        const get = jest.fn().mockResolvedValue({ docs })
        const where = jest.fn().mockReturnValue({ get })
        const collection = jest.fn().mockReturnValue({ where })
        const remove = jest.fn().mockResolvedValue(undefined)
        const doc = jest.fn().mockReturnValue({ delete: remove })
        const db = { collection, doc }

        await expect(deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 2)).resolves.toBe(1)

        expect(collection).toHaveBeenCalledWith('feedsStore/p1/all')
        expect(where).toHaveBeenCalledWith('readerIds', 'array-contains', 'member-1')
        expect(doc).toHaveBeenCalledTimes(1)
        expect(doc).toHaveBeenCalledWith('feedsStore/p1/all/oldest')
        expect(remove).toHaveBeenCalledTimes(1)
    })

    it('does nothing without a signed-in reader id', async () => {
        const db = { collection: jest.fn() }

        await expect(deleteOldVisibleFeeds(db, 'feedsStore/p1/all', null)).resolves.toBe(0)
        expect(db.collection).not.toHaveBeenCalled()
    })

    describe('a document another cleanup already removed (AT feeds cleanup race)', () => {
        it('treats a permission-denied delete of a queried document as already gone and keeps deleting the rest', async () => {
            const docs = [makeFeedDoc('a', 1), makeFeedDoc('b', 2), makeFeedDoc('c', 3), makeFeedDoc('d', 4)]
            const { db, remove, resolveQuery } = makeDb({
                docs,
                deleteResults: { 'feedsStore/p1/all/a': Promise.reject(permissionDenied()) },
            })

            const run = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 2)
            resolveQuery()

            await expect(run).resolves.toBe(1)
            expect(remove).toHaveBeenCalledTimes(2)
            expect(remove).toHaveBeenCalledWith('feedsStore/p1/all/a')
            expect(remove).toHaveBeenCalledWith('feedsStore/p1/all/b')
        })

        it('still rejects when a delete fails for any other reason', async () => {
            const unavailable = Object.assign(new Error('Backend unavailable'), { code: 'unavailable' })
            const { db, resolveQuery } = makeDb({
                docs: [makeFeedDoc('a', 1), makeFeedDoc('b', 2)],
                deleteResults: { 'feedsStore/p1/all/a': Promise.reject(unavailable) },
            })

            const run = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            resolveQuery()

            await expect(run).rejects.toBe(unavailable)
        })

        it('only recognises the two codes that mean the document is gone', () => {
            expect(isAlreadyGoneDeleteError({ code: 'not-found' })).toBe(true)
            expect(isAlreadyGoneDeleteError({ code: 'permission-denied' })).toBe(true)
            expect(isAlreadyGoneDeleteError({ code: 'unavailable' })).toBe(false)
            expect(isAlreadyGoneDeleteError(undefined)).toBe(false)
        })
    })

    describe('concurrent cleanups of the same collection', () => {
        it('shares one in-flight run instead of racing a second query and delete pass', async () => {
            const { db, get, remove, resolveQuery } = makeDb({ docs: [makeFeedDoc('a', 1), makeFeedDoc('b', 2)] })

            const first = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            const second = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            expect(second).toBe(first)
            expect(get).toHaveBeenCalledTimes(1)

            resolveQuery()
            await expect(first).resolves.toBe(1)
            await expect(second).resolves.toBe(1)
            expect(remove).toHaveBeenCalledTimes(1)
        })

        it('runs again once the previous cleanup has settled', async () => {
            const { db, get, resolveQuery } = makeDb({ docs: [] })

            const first = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            resolveQuery()
            await first

            const second = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            expect(second).not.toBe(first)
            expect(get).toHaveBeenCalledTimes(2)
            resolveQuery()
            await second
        })

        it('releases the slot when the run fails so the next edit can retry', async () => {
            const { db, resolveQuery } = makeDb({ docs: [] })
            db.collection = jest.fn().mockReturnValue({
                where: () => ({ get: () => Promise.reject(Object.assign(new Error('boom'), { code: 'unavailable' })) }),
            })

            await expect(deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)).rejects.toThrow('boom')

            db.collection = jest.fn().mockReturnValue({ where: () => ({ get: () => Promise.resolve({ docs: [] }) }) })
            await expect(deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)).resolves.toBe(0)
            expect(resolveQuery).toBeDefined()
        })

        it('keeps different collections and readers independent', async () => {
            const all = makeDb({ docs: [] })
            const followed = makeDb({ docs: [] })
            const db = {
                collection: jest.fn(path => (path.endsWith('/all') ? all.db : followed.db).collection(path)),
                doc: jest.fn(),
            }

            const allRun = deleteOldVisibleFeeds(db, 'feedsStore/p1/all', 'member-1', 1)
            const followedRun = deleteOldVisibleFeeds(db, 'feedsStore/p1/member-1/feeds/followed', 'member-1', 1)
            expect(followedRun).not.toBe(allRun)
            expect(all.get).toHaveBeenCalledTimes(1)
            expect(followed.get).toHaveBeenCalledTimes(1)

            all.resolveQuery()
            followed.resolveQuery()
            await Promise.all([allRun, followedRun])
        })
    })
})
