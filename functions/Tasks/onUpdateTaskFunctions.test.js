jest.mock('firebase-admin', () => {
    const update = jest.fn(() => Promise.resolve())
    const doc = jest.fn(() => ({ update }))

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                doc,
            })),
            {
                Timestamp: {
                    now: jest.fn(() => 'timestamp-now'),
                },
            }
        ),
        __mock: {
            doc,
            update,
        },
    }
})

jest.mock('../Goals/goalsFirestore', () => ({
    updateGoalDynamicProgress: jest.fn(() => Promise.resolve()),
    updateGoalEditionData: jest.fn(() => Promise.resolve()),
}))

jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    TASKS_OBJECTS_TYPE: 'tasks',
    updateRecord: jest.fn(() => Promise.resolve()),
    createRecord: jest.fn(() => Promise.resolve()),
    deleteRecord: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    checkIfObjectIsLocked: jest.fn(() => Promise.resolve(false)),
    isWorkstream: jest.fn(() => false),
    BACKLOG_DATE_NUMERIC: -999,
}))

jest.mock('./tasksFirestoreCloud', () => ({
    updateTaskEditionData: jest.fn(() => Promise.resolve()),
    deleteTaskMetaData: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Firestore/contactsFirestore', () => ({
    updateContactOpenTasksAmount: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserWithTaskActive: jest.fn(() => Promise.resolve([])),
    resetActiveTaskDates: jest.fn(() => Promise.resolve()),
    clearUserTaskInFocusIfMatch: jest.fn(() => Promise.resolve()),
}))

jest.mock('../MyDay/myDayHelperCloud', () => ({
    getActiveTaskRoundedStartAndEndDates: jest.fn(() => ({ endDateUtcValue: 0 })),
}))

jest.mock('./recurringTasksCloud', () => ({
    createRecurringTaskInCloudFunction: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Gold/goldHelper', () => ({
    earnGold: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskSomedaySelectedFeed: jest.fn(() => Promise.resolve()),
}))

const admin = require('firebase-admin')
const { buildTaskProgressReward } = require('./onUpdateTaskFunctions')

describe('onUpdateTaskFunctions reward handling', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('builds deterministic reward data for open task completion', () => {
        const reward = buildTaskProgressReward(
            'task-1',
            {
                done: false,
                userIds: ['owner-1'],
                parentId: null,
            },
            {
                done: true,
                userId: 'owner-1',
                userIds: ['owner-1'],
                currentReviewerId: -2,
                completed: 1776729600000,
                parentId: null,
            }
        )

        expect(reward).toEqual(
            expect.objectContaining({
                userId: 'owner-1',
                rewardKey: 'task_progress:task-1:1776729600000:-2',
                timestamp: 1776729600000,
                dayDate: 20260421,
                slimDate: '21042026',
            })
        )
        expect(reward.gold).toBeGreaterThanOrEqual(1)
        expect(reward.gold).toBeLessThanOrEqual(5)
    })

    test('builds deterministic reward data for workflow forward movement', () => {
        const reward = buildTaskProgressReward(
            'task-2',
            {
                done: false,
                userId: 'owner-1',
                userIds: ['owner-1', 'reviewer-1'],
                parentId: null,
            },
            {
                done: false,
                userId: 'owner-1',
                userIds: ['owner-1', 'reviewer-1', 'reviewer-2'],
                currentReviewerId: 'reviewer-2',
                completed: 1776729600000,
                parentId: null,
            }
        )

        expect(reward).toEqual(
            expect.objectContaining({
                userId: 'reviewer-1',
                rewardKey: 'task_progress:task-2:1776729600000:reviewer-2',
            })
        )
    })
})
