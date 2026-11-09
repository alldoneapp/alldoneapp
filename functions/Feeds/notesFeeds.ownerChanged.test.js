jest.mock('./globalFeedsHelper', () => ({
    generateCurrentDateObject: () => ({ currentDateFormated: '08112026', currentMilliseconds: 1 }),
    generateFeedModel: jest.fn(({ entryText }) => ({ feed: { entryText }, feedId: 'feed-1' })),
    proccessFeed: jest.fn(async () => {}),
    loadFeedObject: jest.fn(async () => ({ isPublicFor: [0], userId: 'old-owner' })),
    addPrivacyForFeedObject: jest.fn(),
}))

const { createNoteOwnerChangedFeed } = require('./notesFeeds')
const { proccessFeed } = require('./globalFeedsHelper')

describe('createNoteOwnerChangedFeed', () => {
    // Copying a template's notes into a guide changes each note's owner. This feed referenced two
    // undefined variables, so copyTemplateObjectsSecondGen threw for every guide join that copied a note.
    it('writes the owner change without throwing', async () => {
        await expect(
            createNoteOwnerChangedFeed(
                'guide',
                { uid: 'new-owner' },
                { uid: 'old-owner' },
                'note-1',
                {},
                { uid: 'u' },
                false
            )
        ).resolves.toBeUndefined()
        const [, , , , , noteFeedObject, , feed] = proccessFeed.mock.calls[0]
        expect(feed).toMatchObject({ entryText: '', newOwnerId: 'new-owner', oldOwnerId: 'old-owner' })
        expect(noteFeedObject.userId).toBe('new-owner')
    })
})
