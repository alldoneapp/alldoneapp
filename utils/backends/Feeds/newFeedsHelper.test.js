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

    it('keeps the day the feed object was filed under', () => {
        const newFeeds = {
            tasks: {
                task1: {
                    feed1: { dateFormated: '27092026', feed: { lastChangeDate: 1790546467082 } },
                    feed2: { feed: { lastChangeDate: 10 } },
                },
            },
        }

        const [withDate, withoutDate] = selectNewFeeds(newFeeds, 99, 'user1').feedsData

        expect(withDate.dateFormated).toBe('27092026')
        expect(withoutDate).not.toHaveProperty('dateFormated')
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
