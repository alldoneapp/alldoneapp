const mockCommit = jest.fn(async () => {})
const mockLoadState = jest.fn(async () => {})
const mockCreateGoalMilestoneChangedFeed = jest.fn(async () => {})
const mockCreateProjectEntryFeed = jest.fn(async () => ({}))

jest.mock('firebase-admin', () => ({ firestore: () => ({}) }))
jest.mock('../shared/contactUpdateHelper', () => ({
    loadFeedsStateForContactWrite: (...args) => mockLoadState(...args),
}))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({ commit: mockCommit })),
}))
jest.mock('../Feeds/goalsFeeds', () => ({
    ...jest.requireActual('../Feeds/goalsFeeds'),
    createGoalMilestoneChangedFeed: (...args) => mockCreateGoalMilestoneChangedFeed(...args),
}))
jest.mock('../Feeds/projectEntryFeeds', () => ({
    createProjectEntryFeed: (...args) => mockCreateProjectEntryFeed(...args),
}))

const { buildGoalToolFeeds, describeMilestoneChange, milestoneAudience } = require('./goalToolFeeds')
const { describeGoalDateChange } = require('../Feeds/goalsFeeds')

const feedUser = { uid: 'user1', via: 'mcp', viaClient: 'Claude' }
const feeds = () => buildGoalToolFeeds({ db: {}, projectId: 'p1', feedUser, userId: 'user1' })

beforeEach(() => jest.clearAllMocks())

describe('goal dates in Updates', () => {
    test('read like the other goal entries', () => {
        expect(describeGoalDateChange({ field: 'milestoneDate', from: '22.11.2026', to: 'Someday' })).toBe(
            'changed milestone date • From 22.11.2026 to Someday'
        )
        expect(describeGoalDateChange({ field: 'startDate', from: '22.11.2026', to: '29.11.2026' })).toBe(
            'changed start date • From 22.11.2026 to 29.11.2026'
        )
        expect(describeGoalDateChange({ field: 'scheduleMode', from: 'dynamic', to: 'fixed' })).toBe(
            'changed scheduling • From automatic milestones to a fixed milestone date'
        )
        expect(describeGoalDateChange({ field: 'progress' })).toBeNull()
    })

    test('each date change becomes its own entry on the goal, in one batch', async () => {
        await feeds().onGoalUpdated(
            { id: 'g1' },
            {
                milestoneDate: { from: '22.11.2026', to: '20.12.2026' },
                startDate: { from: '15.11.2026', to: '20.12.2026' },
                scheduleMode: { from: 'dynamic', to: 'fixed' },
            }
        )
        expect(mockLoadState).toHaveBeenCalledWith({ db: {}, projectId: 'p1', feedUser, userId: 'user1' })
        expect(mockCreateGoalMilestoneChangedFeed.mock.calls.map(call => call[1])).toEqual([
            { field: 'milestoneDate', from: '22.11.2026', to: '20.12.2026' },
            { field: 'startDate', from: '15.11.2026', to: '20.12.2026' },
            { field: 'scheduleMode', from: 'dynamic', to: 'fixed' },
        ])
        mockCreateGoalMilestoneChangedFeed.mock.calls.forEach(call => {
            expect(call[0]).toBe('p1')
            expect(call[2]).toBe('g1')
            expect(call[4]).toBe(feedUser)
            expect(call[5]).toBe(true)
        })
        expect(mockCommit).toHaveBeenCalledTimes(1)
    })
})

describe('milestones in Updates', () => {
    test('a milestone change reads as a line on the project', () => {
        expect(describeMilestoneChange({ kind: 'renamed', from: '', to: 'Discovery', day: '22.11.2026' })).toBe(
            'named milestone of 22.11.2026 • "Discovery"'
        )
        expect(describeMilestoneChange({ kind: 'renamed', from: 'Discovery', to: 'Launch', day: '22.11.2026' })).toBe(
            'renamed milestone • From "Discovery" to "Launch"'
        )
        expect(describeMilestoneChange({ kind: 'renamed', from: 'Discovery', to: '', day: '22.11.2026' })).toBe(
            'removed the name of milestone of 22.11.2026 • Was "Discovery"'
        )
        expect(describeMilestoneChange({ kind: 'moved', name: '', from: '22.11.2026', to: '20.12.2026' })).toBe(
            'moved milestone • From 22.11.2026 to 20.12.2026'
        )
        expect(
            describeMilestoneChange({
                kind: 'moved',
                name: 'Launch',
                from: '22.11.2026',
                to: '20.12.2026',
                merged: true,
            })
        ).toBe(
            'moved milestone "Launch" • From 22.11.2026 to 20.12.2026, merged with the milestone already on that day'
        )
        expect(describeMilestoneChange({ kind: 'done', name: 'Launch', day: '20.12.2026' })).toBe(
            'marked milestone "Launch" as done'
        )
        expect(describeMilestoneChange({ kind: 'reopened', name: '', day: '20.12.2026' })).toBe(
            'reopened milestone of 20.12.2026'
        )
        expect(describeMilestoneChange({ kind: 'something' })).toBeNull()
    })

    test("everybody's milestone is the project's, a guide member's own milestone is theirs", () => {
        expect(milestoneAudience('ALL_USERS')).toEqual([0])
        expect(milestoneAudience(undefined)).toEqual([0])
        expect(milestoneAudience('user1')).toEqual(['user1'])
    })

    test('each change is written on the project with the milestone’s audience', async () => {
        const project = { id: 'p1', name: 'Growth', userIds: ['user1', 'user2'] }
        await feeds().onMilestoneUpdated(
            { id: 'm1', ownerId: 'user1' },
            [
                { kind: 'renamed', from: '', to: 'Discovery', day: '22.11.2026' },
                { kind: 'done', name: 'Discovery', day: '22.11.2026' },
            ],
            project
        )
        expect(mockCreateProjectEntryFeed).toHaveBeenCalledTimes(2)
        expect(mockCreateProjectEntryFeed.mock.calls[0][0]).toMatchObject({
            projectId: 'p1',
            project,
            feedType: 'FEED_PROJECT_MILESTONE_CHANGED',
            entryText: 'named milestone of 22.11.2026 • "Discovery"',
            isPublicFor: ['user1'],
            extraFields: { milestoneId: 'm1' },
            feedUser,
        })
        expect(mockCreateProjectEntryFeed.mock.calls[1][0].entryText).toBe('marked milestone "Discovery" as done')
        expect(mockCommit).toHaveBeenCalledTimes(1)
    })

    test('nothing to say writes nothing', async () => {
        await feeds().onMilestoneUpdated({ id: 'm1' }, [{ kind: 'unknown' }], {})
        expect(mockLoadState).not.toHaveBeenCalled()
        expect(mockCommit).not.toHaveBeenCalled()
    })
})
