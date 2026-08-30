import { deleteOldVisibleFeeds } from './feedCleanup'

const makeFeedDoc = (id, lastChangeDate) => ({
    id,
    data: () => ({ lastChangeDate }),
})

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
})
