const mockLoadFeedObject = jest.fn()
const mockGetObjectFollowersIds = jest.fn()
const mockProccessFeed = jest.fn(async () => {})

jest.mock('./globalFeedsHelper', () => ({
    generateCurrentDateObject: () => ({ currentDateFormated: '09112026', currentMilliseconds: 1000 }),
    generateFeedModel: ({ feedType, lastChangeDate, entryText, feedUser, objectId, isPublicFor }) => ({
        feedId: 'feed-1',
        feed: {
            type: feedType,
            lastChangeDate,
            entryText,
            creatorId: feedUser.uid,
            objectId,
            isPublicFor,
            ...(feedUser.via ? { via: feedUser.via, viaClient: feedUser.viaClient } : {}),
        },
    }),
    proccessFeed: (...args) => mockProccessFeed(...args),
    loadFeedObject: (...args) => mockLoadFeedObject(...args),
    getObjectFollowersIds: (...args) => mockGetObjectFollowersIds(...args),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))

const { createProjectEntryFeed } = require('./projectEntryFeeds')

const project = { id: 'p1', name: 'Growth', color: '#123', userIds: ['owner', 'member', 'other'] }
const feedUser = { uid: 'owner', via: 'mcp', viaClient: 'Claude' }

beforeEach(() => {
    jest.clearAllMocks()
    mockGetObjectFollowersIds.mockResolvedValue(['member', 'other'])
})

describe('an entry on the project for something without a feed object of its own', () => {
    test('a project-wide entry goes to every follower of the project, with the extra ids', async () => {
        const projectFeedObject = { type: 'project', name: 'Growth', isPublicFor: [0] }
        mockLoadFeedObject.mockResolvedValue(projectFeedObject)
        const batch = {}

        await createProjectEntryFeed({
            projectId: 'p1',
            project,
            feedType: 'FEED_PROJECT_OKR_CREATED',
            entryText: 'created OKR "Revenue"',
            isPublicFor: [0],
            extraFields: { okrId: 'o1' },
            batch,
            feedUser,
        })

        expect(batch.followersIds).toEqual({ p1: ['member', 'other', 'owner'] })
        const [projectId, date, , objectId, objectsType, feedObject, feedId, feed, actor, , notify, context] =
            mockProccessFeed.mock.calls[0]
        expect([projectId, date, objectId, objectsType, feedId, notify]).toEqual([
            'p1',
            '09112026',
            'p1',
            'projects',
            'feed-1',
            true,
        ])
        expect(feedObject).toBe(projectFeedObject)
        expect(feed).toEqual({
            type: 'FEED_PROJECT_OKR_CREATED',
            lastChangeDate: 1000,
            entryText: 'created OKR "Revenue"',
            creatorId: 'owner',
            objectId: 'p1',
            isPublicFor: [0],
            via: 'mcp',
            viaClient: 'Claude',
            okrId: 'o1',
        })
        expect(actor).toBe(feedUser)
        expect(context).toEqual({ project })
    })

    test('a private entry reaches only the stores of followers who may read it', async () => {
        mockLoadFeedObject.mockResolvedValue({ type: 'project', isPublicFor: [0] })
        const batch = {}

        await createProjectEntryFeed({
            projectId: 'p1',
            project,
            feedType: 'FEED_PROJECT_OKR_CHANGED',
            entryText: 'changed OKR "Revenue" • Made private',
            isPublicFor: ['owner'],
            batch,
            feedUser,
        })

        expect(batch.followersIds).toEqual({ p1: ['owner'] })
        expect(mockProccessFeed.mock.calls[0][7].isPublicFor).toEqual(['owner'])

        // A later project-wide entry in the same batch is not narrowed by the earlier one.
        await createProjectEntryFeed({
            projectId: 'p1',
            project,
            feedType: 'FEED_PROJECT_MILESTONE_CHANGED',
            entryText: 'reopened milestone of 22.11.2026',
            isPublicFor: [0],
            batch,
            feedUser,
        })
        expect(batch.followersIds).toEqual({ p1: ['member', 'other', 'owner'] })
        expect(mockGetObjectFollowersIds).toHaveBeenCalledTimes(1)
    })

    test('a project without a stored feed object gets one built from the project', async () => {
        mockLoadFeedObject.mockResolvedValue(undefined)
        const batch = {}

        await createProjectEntryFeed({
            projectId: 'p1',
            project,
            feedType: 'FEED_PROJECT_MILESTONE_CHANGED',
            entryText: 'reopened milestone of 22.11.2026',
            batch,
            feedUser: { uid: 'assistant-1' },
        })

        const feedObject = mockProccessFeed.mock.calls[0][5]
        expect(feedObject).toMatchObject({ type: 'project', name: 'Growth', color: '#123', projectId: 'p1' })
        expect(batch.feedObjects.p1).toBe(feedObject)
        expect(mockProccessFeed.mock.calls[0][7].isPublicFor).toEqual([0])
    })
})
