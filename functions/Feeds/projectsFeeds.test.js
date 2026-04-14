const mockGenerateCurrentDateObject = jest.fn()
const mockGenerateFeedModel = jest.fn()
const mockProccessFeed = jest.fn()
const mockLoadFeedObject = jest.fn()

jest.mock('./globalFeedsHelper', () => ({
    generateCurrentDateObject: (...args) => mockGenerateCurrentDateObject(...args),
    generateFeedModel: (...args) => mockGenerateFeedModel(...args),
    proccessFeed: (...args) => mockProccessFeed(...args),
    loadFeedObject: (...args) => mockLoadFeedObject(...args),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'FEED_PUBLIC_FOR_ALL',
}))

const { createProjectDescriptionChangedFeed } = require('./projectsFeeds')

describe('projectsFeeds', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGenerateCurrentDateObject.mockReturnValue({
            currentDateFormated: '14042026',
            currentMilliseconds: 1234567890,
        })
        mockGenerateFeedModel.mockReturnValue({
            feed: { type: 321, entryText: 'changed description', isPublicFor: ['FEED_PUBLIC_FOR_ALL'] },
            feedId: 'feed-1',
        })
        mockProccessFeed.mockResolvedValue(undefined)
    })

    test('updates an existing project feed object description and processes the feed', async () => {
        const batch = { feedObjects: {} }
        const existingFeedObject = {
            type: 'project',
            name: 'Operations',
            description: 'Old description',
            isPublicFor: ['FEED_PUBLIC_FOR_ALL'],
        }
        mockLoadFeedObject.mockResolvedValue(existingFeedObject)

        await createProjectDescriptionChangedFeed(
            'project-1',
            { name: 'Operations', color: '#fff', userIds: ['user-1'] },
            'New description',
            'Old description',
            batch,
            { uid: 'user-1' }
        )

        expect(existingFeedObject.description).toBe('New description')
        expect(mockGenerateFeedModel).toHaveBeenCalledWith(
            expect.objectContaining({
                objectId: 'project-1',
            })
        )
        expect(mockProccessFeed).toHaveBeenCalledWith(
            'project-1',
            '14042026',
            [],
            'project-1',
            'projects',
            existingFeedObject,
            'feed-1',
            expect.any(Object),
            { uid: 'user-1' },
            batch,
            false,
            { project: { name: 'Operations', color: '#fff', userIds: ['user-1'] } }
        )
    })

    test('creates a fallback project feed object when none exists yet', async () => {
        const batch = { feedObjects: {} }
        mockLoadFeedObject.mockResolvedValue(null)

        await createProjectDescriptionChangedFeed(
            'project-1',
            { name: 'Operations', color: '#fff', description: 'New description', userIds: ['user-1'] },
            'New description',
            '',
            batch,
            { uid: 'user-1' }
        )

        expect(batch.feedObjects['project-1']).toMatchObject({
            type: 'project',
            name: 'Operations',
            color: '#fff',
            description: 'New description',
            projectId: 'project-1',
        })
    })
})
