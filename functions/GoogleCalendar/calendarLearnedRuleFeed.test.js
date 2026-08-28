'use strict'

const mockCommit = jest.fn()
const mockCreateTaskUpdatedFeed = jest.fn()
const mockGenerateTaskObjectModel = jest.fn(() => ({ type: 'task' }))
const mockLoadFeedsGlobalState = jest.fn()
const mockSetProjectContext = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ id: 'db' })),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        commit: mockCommit,
        feedObjects: {},
        setProjectContext: mockSetProjectContext,
    })),
}))

jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskUpdatedFeed: mockCreateTaskUpdatedFeed,
}))

jest.mock('../Feeds/tasksFeedsHelper', () => ({
    generateTaskObjectModel: mockGenerateTaskObjectModel,
}))

jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: mockLoadFeedsGlobalState,
}))

const { buildCalendarLearnedRuleFeedText, createCalendarLearnedRuleFeed } = require('./calendarLearnedRuleFeed')

describe('calendarLearnedRuleFeed', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockCommit.mockResolvedValue(undefined)
        mockCreateTaskUpdatedFeed.mockResolvedValue(undefined)
    })

    test('writes a deterministic task feed for a newly learned project rule', async () => {
        const task = { id: 'task-1', name: 'Weekly Acme status' }

        const result = await createCalendarLearnedRuleFeed({
            feedbackId: 'feedback-1',
            projectId: 'project-a',
            projectData: { name: 'Project A', userIds: ['user-1'] },
            task,
            userId: 'user-1',
            userData: { displayName: 'Test User' },
            ruleType: 'project',
            targetProject: { projectId: 'project-a', name: 'Project A' },
        })

        expect(result).toEqual({ feedId: 'calendar-learned-rule-feedback-1' })
        expect(mockSetProjectContext).toHaveBeenCalledWith('project-a')
        expect(mockCreateTaskUpdatedFeed).toHaveBeenCalledWith(
            'project-a',
            task,
            'task-1',
            expect.any(Object),
            expect.objectContaining({ uid: 'user-1' }),
            false,
            {
                feedId: 'calendar-learned-rule-feedback-1',
                entryText: 'created a learned calendar project rule • Route “Weekly Acme status” to “Project A”',
            }
        )
        expect(mockCommit).toHaveBeenCalledTimes(1)
    })

    test('describes Goal additions and removals explicitly', () => {
        expect(
            buildCalendarLearnedRuleFeedText({
                task: { name: 'Weekly Acme status' },
                ruleType: 'goal',
                selectedGoal: { name: 'Client delivery' },
            })
        ).toBe('created a learned calendar Goal rule • Add “Weekly Acme status” to Goal “Client delivery”')
        expect(
            buildCalendarLearnedRuleFeedText({
                task: { name: 'Weekly Acme status' },
                ruleType: 'goal',
                selectedGoal: null,
            })
        ).toBe('created a learned calendar Goal rule • Leave “Weekly Acme status” without a Goal')
    })
})
