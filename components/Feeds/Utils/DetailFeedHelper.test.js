import { filterUserObjectFeeds, shouldDisplayLocalFeedInDetailedView } from './DetailFeedHelper'

describe('DetailFeedHelper', () => {
    describe('shouldDisplayLocalFeedInDetailedView', () => {
        it('ignores local feeds for other object ids in a user detail updates tab', () => {
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'note-1', type: 'note' })).toBe(false)
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'task-1', type: 'task' })).toBe(false)
        })

        it('accepts local user feeds for the viewed user object', () => {
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'user-1', type: 'user' })).toBe(true)
        })
    })

    describe('filterUserObjectFeeds', () => {
        it('keeps only historical user feeds whose object id matches the viewed user', () => {
            const feeds = [
                { id: 'feed-1', objectId: 'user-1' },
                { id: 'feed-2', objectId: 'note-1' },
                { id: 'feed-3', objectId: 'task-1' },
                { id: 'feed-4', objectId: 'user-1' },
            ]

            expect(filterUserObjectFeeds(feeds, 'user-1')).toEqual([
                { id: 'feed-1', objectId: 'user-1' },
                { id: 'feed-4', objectId: 'user-1' },
            ])
        })

        it('preserves unloaded feeds state', () => {
            expect(filterUserObjectFeeds(null, 'user-1')).toBeNull()
        })
    })
})
