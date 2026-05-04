import { selectNewFeeds } from './newFeedsHelper'

describe('selectNewFeeds', () => {
    it('counts distinct updated objects while returning activity feeds', () => {
        const newFeeds = {
            tasks: {
                task1: {
                    feed1: { feed: { lastChangeDate: 10, type: 'task-created' } },
                    feed2: { feed: { lastChangeDate: 30, type: 'task-followed' } },
                },
                hiddenTask: {
                    isPrivate: 'other-user',
                    feed3: { feed: { lastChangeDate: 40, type: 'task-private' } },
                },
            },
            notes: {
                note1: {
                    feed4: { feed: { lastChangeDate: 20, type: 'note-updated' } },
                },
                privateNote: {
                    isPrivate: 'user1',
                    feed5: { feed: { lastChangeDate: 50, type: 'note-private' } },
                },
            },
        }

        const result = selectNewFeeds(newFeeds, 99, 'user1')

        expect(result.feedsAmount).toBe(3)
        expect(result.feedsData.map(feed => feed.id)).toEqual(['feed5', 'feed2', 'feed4', 'feed1'])
        expect(result.feedsData.map(feed => feed.objectId)).toEqual(['privateNote', 'task1', 'note1', 'task1'])
        expect(result.feedsData.map(feed => feed.objectTypes)).toEqual(['notes', 'tasks', 'notes', 'tasks'])
    })

    it('limits returned feed rows without limiting the object count', () => {
        const newFeeds = {
            tasks: {
                task1: {
                    feed1: { feed: { lastChangeDate: 10 } },
                    feed2: { feed: { lastChangeDate: 20 } },
                },
                task2: {
                    feed3: { feed: { lastChangeDate: 30 } },
                },
            },
        }

        const result = selectNewFeeds(newFeeds, 2, 'user1')

        expect(result.feedsAmount).toBe(2)
        expect(result.feedsData.map(feed => feed.id)).toEqual(['feed3', 'feed2'])
    })
})
