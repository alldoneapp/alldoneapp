const mockLoadFeedObject = jest.fn()
const mockProccessFeed = jest.fn(async () => {})
const mockGenerateFeedModel = jest.fn(args => ({ feedId: 'feed-1', feed: { type: args.feedType, ...args } }))

jest.mock('./globalFeedsHelper', () => ({
    generateCurrentDateObject: () => ({ currentDateFormated: '09112026', currentMilliseconds: 1000 }),
    generateFeedModel: (...args) => mockGenerateFeedModel(...args),
    proccessFeed: (...args) => mockProccessFeed(...args),
    loadFeedObject: (...args) => mockLoadFeedObject(...args),
    addPrivacyForFeedObject: jest.fn(),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    getTaskNameWithoutMeta: name => name,
    FEED_PUBLIC_FOR_ALL: 0,
    CAPACITY_NONE: 'CAPACITY_NONE',
    DYNAMIC_PERCENT: 'DYNAMIC_PERCENT',
}))

const { createGoalMilestoneChangedFeed } = require('./goalsFeeds')
const { FEED_GOAL_MILESTONE_CHANGED } = require('./FeedsConstants')

beforeEach(() => jest.clearAllMocks())

describe("a goal's dates in Updates", () => {
    test('is a FEED_GOAL_MILESTONE_CHANGED line on the goal, as private as the goal', async () => {
        const goalFeedObject = { type: 'goal', isPublicFor: ['user1'] }
        mockLoadFeedObject.mockResolvedValue(goalFeedObject)
        const batch = {}
        const feedUser = { uid: 'user1' }

        await createGoalMilestoneChangedFeed(
            'p1',
            { field: 'milestoneDate', from: '22.11.2026', to: '20.12.2026' },
            'g1',
            batch,
            feedUser,
            true
        )

        expect(FEED_GOAL_MILESTONE_CHANGED).toBe(83)
        expect(mockGenerateFeedModel).toHaveBeenCalledWith({
            feedType: 83,
            lastChangeDate: 1000,
            entryText: 'changed milestone date • From 22.11.2026 to 20.12.2026',
            feedUser,
            objectId: 'g1',
            isPublicFor: ['user1'],
        })
        expect(mockProccessFeed).toHaveBeenCalledWith(
            'p1',
            '09112026',
            [],
            'g1',
            'goals',
            goalFeedObject,
            'feed-1',
            expect.objectContaining({ type: 83 }),
            feedUser,
            batch,
            true
        )
    })

    test('writes nothing for a goal without feed state, or a change it cannot describe', async () => {
        mockLoadFeedObject.mockResolvedValue(undefined)
        await createGoalMilestoneChangedFeed('p1', { field: 'startDate', from: 'a', to: 'b' }, 'g1', {}, {}, true)
        mockLoadFeedObject.mockResolvedValue({ isPublicFor: [0] })
        await createGoalMilestoneChangedFeed('p1', { field: 'name' }, 'g1', {}, {}, true)
        expect(mockProccessFeed).not.toHaveBeenCalled()
    })
})
