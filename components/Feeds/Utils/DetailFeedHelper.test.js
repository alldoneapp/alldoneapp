import {
    filterDetailedViewFeeds,
    getAttachedNoteFeedSource,
    getAttachedNoteId,
    shouldDisplayLocalFeedInDetailedView,
} from './DetailFeedHelper'

describe('DetailFeedHelper', () => {
    describe('shouldDisplayLocalFeedInDetailedView', () => {
        it('ignores local feeds for other object ids in a user detail updates tab', () => {
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'note-1', type: 'note' })).toBe(false)
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'task-1', type: 'task' })).toBe(false)
        })

        it('accepts local user feeds for the viewed user object', () => {
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'user-1', type: 'user' })).toBe(true)
        })

        it('accepts local attached note feeds for the viewed object', () => {
            expect(shouldDisplayLocalFeedInDetailedView('user-1', { id: 'note-1', type: 'note' }, ['note-1'])).toBe(
                true
            )
        })
    })

    describe('filterDetailedViewFeeds', () => {
        it('keeps historical feeds for the viewed object and its attached note', () => {
            const feeds = [
                { id: 'feed-1', objectId: 'user-1' },
                { id: 'feed-2', objectId: 'note-1' },
                { id: 'feed-3', objectId: 'task-1' },
                { id: 'feed-4', objectId: 'user-1' },
            ]

            expect(filterDetailedViewFeeds(feeds, 'user-1', ['note-1'])).toEqual([
                { id: 'feed-1', objectId: 'user-1' },
                { id: 'feed-2', objectId: 'note-1' },
                { id: 'feed-4', objectId: 'user-1' },
            ])
        })

        it('preserves unloaded feeds state', () => {
            expect(filterDetailedViewFeeds(null, 'user-1')).toBeNull()
        })
    })

    describe('attached note helpers', () => {
        it('resolves object note ids and project-specific note ids', () => {
            expect(getAttachedNoteId({ noteId: 'note-1' }, 'project-1')).toBe('note-1')
            expect(getAttachedNoteId({ noteIdsByProject: { 'project-1': 'note-2' } }, 'project-1')).toBe('note-2')
        })

        it('creates note feed sources only when an attached note exists', () => {
            expect(getAttachedNoteFeedSource('note-1')).toEqual({ objectTypes: 'notes', feedObjectId: 'note-1' })
            expect(getAttachedNoteFeedSource()).toBeNull()
        })
    })
})
