import {
    applyVisibleFeedPrivacy,
    canWriteFeedPrivacyAs,
    deleteVisibleFollowedFeeds,
    getFeedPrivacyReaders,
    mergeFeedPrivacy,
} from './feedPrivacy'

const ME = 'member-me'
const TEAMMATE = 'member-other'
const PROJECT = 'p1'
const TASK = 'task-1'

// A db double that records every query shape and answers per collection path.
const makeDb = (docsByPath = {}) => {
    const queries = []
    const collection = jest.fn(path => {
        const clauses = []
        const chain = {
            where: jest.fn((...clause) => {
                clauses.push(clause)
                return chain
            }),
            get: jest.fn(() => {
                queries.push({ path, clauses })
                return Promise.resolve({ docs: docsByPath[path] || [] })
            }),
        }
        return chain
    })
    const doc = jest.fn(path => ({ path }))
    return { db: { collection, doc }, queries }
}

const makeBatch = () => ({ set: jest.fn(), delete: jest.fn() })
const feedDoc = (id, data = {}) => ({ id, data: () => data })

describe('getFeedPrivacyReaders', () => {
    it('treats the project-public sentinel as every member having access', () => {
        expect(getFeedPrivacyReaders([0], [ME, TEAMMATE])).toEqual({
            isProjectWide: true,
            usersWithAccess: [ME, TEAMMATE],
            usersWithoutAccess: [],
        })
    })

    it('splits the members of a private object by the isPublicFor list', () => {
        expect(getFeedPrivacyReaders([ME, 'former-member'], [ME, TEAMMATE])).toEqual({
            isProjectWide: false,
            usersWithAccess: [ME],
            usersWithoutAccess: [TEAMMATE],
        })
    })

    it('survives missing inputs', () => {
        expect(getFeedPrivacyReaders(undefined, undefined)).toEqual({
            isProjectWide: false,
            usersWithAccess: [],
            usersWithoutAccess: [],
        })
    })
})

describe('mergeFeedPrivacy / canWriteFeedPrivacyAs', () => {
    it('keeps the readers a comment was shared with on top of the object privacy', () => {
        expect(mergeFeedPrivacy({ isCommentPublicFor: ['guest', ME] }, [ME])).toEqual([ME, 'guest'])
        expect(mergeFeedPrivacy({}, [ME])).toEqual([ME])
    })

    it('only lets a writer rewrite entries that still name them or the project', () => {
        expect(canWriteFeedPrivacyAs([0], ME)).toBe(true)
        expect(canWriteFeedPrivacyAs([ME, TEAMMATE], ME)).toBe(true)
        expect(canWriteFeedPrivacyAs([TEAMMATE], ME)).toBe(false)
        expect(canWriteFeedPrivacyAs(undefined, ME)).toBe(false)
    })
})

describe('applyVisibleFeedPrivacy (the browser half of a privacy change)', () => {
    const ownStore = `/feedsStore/${PROJECT}/${ME}/feeds/followed`
    const allStore = `/feedsStore/${PROJECT}/all`
    const history = `projectsInnerFeeds/${PROJECT}/tasks/${TASK}/feeds`

    it('rewrites only the stores a browser may read, through readerIds-shaped queries', async () => {
        const { db, queries } = makeDb({
            [ownStore]: [feedDoc('own-1')],
            [allStore]: [feedDoc('all-1', { isCommentPublicFor: ['guest'] })],
            [history]: [feedDoc('hist-1')],
        })
        const batch = makeBatch()

        await expect(
            applyVisibleFeedPrivacy(db, batch, {
                projectId: PROJECT,
                objectId: TASK,
                objectTypes: 'tasks',
                isPublicFor: [ME],
                loggedUserId: ME,
                readerId: ME,
            })
        ).resolves.toEqual({ deleted: 0, updated: 3 })

        // Every query carries the reader projection: a bare objectId query is refused by the rules.
        expect(queries.map(query => query.path)).toEqual([ownStore, allStore, history])
        queries.forEach(query =>
            expect(query.clauses).toEqual([
                ['objectId', '==', TASK],
                ['readerIds', 'array-contains', ME],
            ])
        )
        // No other member's followed store is ever queried: the rules gate it on the owner.
        expect(db.collection).not.toHaveBeenCalledWith(expect.stringContaining(`/${TEAMMATE}/`))

        expect(batch.delete).not.toHaveBeenCalled()
        expect(batch.set).toHaveBeenCalledTimes(3)
        expect(batch.set).toHaveBeenCalledWith(
            { path: `${allStore}/all-1` },
            { isPublicFor: [ME, 'guest'] },
            { merge: true }
        )
        expect(batch.set).toHaveBeenCalledWith({ path: `${ownStore}/own-1` }, { isPublicFor: [ME] }, { merge: true })
        expect(batch.set).toHaveBeenCalledWith({ path: `${history}/hist-1` }, { isPublicFor: [ME] }, { merge: true })
    })

    it('removes the entries from its own store when the change takes the writer’s access away', async () => {
        const { db, queries } = makeDb({
            [ownStore]: [feedDoc('own-1'), feedDoc('own-2')],
            [allStore]: [feedDoc('all-1')],
        })
        const batch = makeBatch()

        await expect(
            applyVisibleFeedPrivacy(db, batch, {
                projectId: PROJECT,
                objectId: TASK,
                objectTypes: 'tasks',
                isPublicFor: [TEAMMATE],
                loggedUserId: ME,
                readerId: ME,
            })
        ).resolves.toEqual({ deleted: 2, updated: 0 })

        // The shared stores are not rewritten: the update rule would refuse a document that no
        // longer names the writer. They are the server's to reconcile.
        expect(queries.map(query => query.path)).toEqual([ownStore])
        expect(batch.set).not.toHaveBeenCalled()
        expect(batch.delete).toHaveBeenCalledTimes(2)
        expect(batch.delete).toHaveBeenCalledWith({ path: `${ownStore}/own-1` })
    })

    it('does nothing without a signed-in user', async () => {
        const { db } = makeDb()
        const batch = makeBatch()
        await expect(
            applyVisibleFeedPrivacy(db, batch, {
                projectId: PROJECT,
                objectId: TASK,
                objectTypes: 'tasks',
                isPublicFor: [0],
            })
        ).resolves.toEqual({ deleted: 0, updated: 0 })
        expect(db.collection).not.toHaveBeenCalled()
    })
})

describe('deleteVisibleFollowedFeeds', () => {
    it('deletes through the reader projection and only from the signed-in user’s own store', async () => {
        const ownStore = `/feedsStore/${PROJECT}/${ME}/feeds/followed`
        const { db, queries } = makeDb({ [ownStore]: [feedDoc('own-1')] })
        const batch = makeBatch()

        await expect(
            deleteVisibleFollowedFeeds(db, batch, {
                projectId: PROJECT,
                userId: ME,
                loggedUserId: ME,
                objectId: TASK,
                readerId: ME,
            })
        ).resolves.toBe(1)
        expect(queries[0].clauses).toEqual([
            ['objectId', '==', TASK],
            ['readerIds', 'array-contains', ME],
        ])
        expect(batch.delete).toHaveBeenCalledWith({ path: `${ownStore}/own-1` })

        await expect(
            deleteVisibleFollowedFeeds(db, batch, {
                projectId: PROJECT,
                userId: TEAMMATE,
                loggedUserId: ME,
                objectId: TASK,
                readerId: ME,
            })
        ).resolves.toBe(0)
        expect(db.collection).toHaveBeenCalledTimes(1)
    })
})
