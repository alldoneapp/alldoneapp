/**
 * @jest-environment jsdom
 */

import { getChatsAmountQueryLimit, watchChatsAmount, unwatchChatsAmount } from './chatNumbers'
import { getDb, globalWatcherUnsub } from '../firestore'
import { ALL_TAB, FOLLOWED_TAB, FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

jest.mock('../firestore', () => ({ getDb: jest.fn(), globalWatcherUnsub: {} }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: { uid: 'user-1' } }) },
}))

const LOGGED_USER_ID = 'user-1'

const createQueryMock = () => {
    const query = {
        where: jest.fn(() => query),
        limit: jest.fn(() => query),
        onSnapshot: jest.fn(() => jest.fn()),
    }
    return query
}

const setupDb = () => {
    const query = createQueryMock()
    const collection = jest.fn(() => query)
    getDb.mockReturnValue({ collection })
    return { query, collection }
}

describe('getChatsAmountQueryLimit', () => {
    it('caps the query one document past what the list renders', () => {
        expect(getChatsAmountQueryLimit(3)).toBe(4)
        expect(getChatsAmountQueryLimit(10)).toBe(11)
    })

    it('falls back to no limit for non-positive or non-numeric amounts', () => {
        // Firestore rejects limit(0) / limit(-n), so those must not produce a limit clause.
        expect(getChatsAmountQueryLimit(0)).toBeNull()
        expect(getChatsAmountQueryLimit(-5)).toBeNull()
        expect(getChatsAmountQueryLimit(undefined)).toBeNull()
        expect(getChatsAmountQueryLimit(NaN)).toBeNull()
    })

    /**
     * ChatsByProject never displays the amount, it only compares it against `toRender`.
     * Saturating the count at `toRender + 1` must leave every one of those comparisons unchanged,
     * which is what makes the capped query a drop-in replacement for the unbounded one.
     */
    it('preserves every comparison ChatsByProject makes against toRender', () => {
        const realCounts = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 500, 3224]

        for (const toRender of [3, 10, 20]) {
            const limit = getChatsAmountQueryLimit(toRender)

            for (const real of realCounts) {
                const capped = Math.min(real, limit)

                // "show more" button
                expect(capped > toRender).toBe(real > toRender)
                // "collapse" button
                expect(toRender <= capped).toBe(toRender <= real)
                // atEnd flag: `totalChats / toRender < 1`
                expect(capped / toRender < 1).toBe(real / toRender < 1)
            }
        }
    })
})

describe('watchChatsAmount', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        Object.keys(globalWatcherUnsub).forEach(key => delete globalWatcherUnsub[key])
    })

    it('limits the ALL tab amount query instead of reading the whole collection', () => {
        const { query, collection } = setupDb()

        watchChatsAmount('project-1', 'watcher-1', jest.fn(), ALL_TAB, 3)

        expect(collection).toHaveBeenCalledWith('chatObjects/project-1/chats')
        expect(query.where).toHaveBeenCalledWith('isPublicFor', 'array-contains-any', [
            FEED_PUBLIC_FOR_ALL,
            LOGGED_USER_ID,
        ])
        expect(query.limit).toHaveBeenCalledWith(4)
        expect(query.onSnapshot).toHaveBeenCalledTimes(1)
    })

    it('limits the followed tab amount query and keeps its filter', () => {
        const { query } = setupDb()

        watchChatsAmount('project-1', 'watcher-1', jest.fn(), FOLLOWED_TAB, 10)

        expect(query.where).toHaveBeenCalledWith('usersFollowing', 'array-contains', LOGGED_USER_ID)
        expect(query.limit).toHaveBeenCalledWith(11)
    })

    it('does not add a limit clause when no visible amount is provided', () => {
        const { query } = setupDb()

        watchChatsAmount('project-1', 'watcher-1', jest.fn(), ALL_TAB, undefined)

        expect(query.limit).not.toHaveBeenCalled()
        expect(query.onSnapshot).toHaveBeenCalledTimes(1)
    })

    it('reports the number of documents received and unsubscribes on unwatch', () => {
        const { query } = setupDb()
        const unsubscribe = jest.fn()
        query.onSnapshot.mockReturnValue(unsubscribe)
        const callback = jest.fn()

        watchChatsAmount('project-1', 'watcher-1', callback, ALL_TAB, 3)

        const handleSnapshot = query.onSnapshot.mock.calls[0][0]
        handleSnapshot({ docs: [{}, {}, {}, {}] })
        expect(callback).toHaveBeenCalledWith(4)

        unwatchChatsAmount('watcher-1')
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
})
