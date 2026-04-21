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

jest.mock('googleapis', () => ({
    google: {
        gmail: jest.fn(),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn(),
    getOAuth2Client: jest.fn(),
}))

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
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { archiveGmailTaskIfNeeded, buildTaskProgressReward } = require('./onUpdateTaskFunctions')

describe('onUpdateTaskFunctions Gmail archive handling', () => {
    const baseTask = {
        userId: 'user-1',
        done: false,
        dueDate: 1000,
        gmailData: {
            origin: 'gmail_label_follow_up',
            projectId: 'gmail-project',
            messageId: 'msg-1',
            archiveOnComplete: true,
        },
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('archives Gmail-origin message when task is completed', async () => {
        const modify = jest.fn(() => Promise.resolve())
        const setCredentials = jest.fn()

        getAccessToken.mockResolvedValue('token-1')
        getOAuth2Client.mockReturnValue({ setCredentials })
        google.gmail.mockReturnValue({
            users: {
                messages: {
                    modify,
                },
            },
        })

        await archiveGmailTaskIfNeeded('project-1', 'task-1', baseTask, {
            ...baseTask,
            done: true,
        })

        expect(getAccessToken).toHaveBeenCalledWith('user-1', 'gmail-project', 'gmail')
        expect(modify).toHaveBeenCalledWith({
            userId: 'me',
            id: 'msg-1',
            requestBody: {
                removeLabelIds: ['INBOX'],
            },
        })
        expect(admin.__mock.doc).toHaveBeenCalledWith('items/project-1/tasks/task-1')
        expect(admin.__mock.update).toHaveBeenCalledWith({
            gmailData: expect.objectContaining({
                origin: 'gmail_label_follow_up',
                projectId: 'gmail-project',
                messageId: 'msg-1',
                archiveOnComplete: true,
                archiveStatus: expect.objectContaining({
                    state: 'completed',
                    error: '',
                    messageId: 'msg-1',
                }),
            }),
        })
    })

    test('records archive failure without throwing', async () => {
        getAccessToken.mockRejectedValue(new Error('User not authenticated with Google for gmail'))

        await expect(
            archiveGmailTaskIfNeeded('project-1', 'task-1', baseTask, {
                ...baseTask,
                done: true,
            })
        ).resolves.toBeUndefined()

        expect(admin.__mock.update).toHaveBeenCalledWith({
            gmailData: expect.objectContaining({
                origin: 'gmail_label_follow_up',
                projectId: 'gmail-project',
                messageId: 'msg-1',
                archiveOnComplete: true,
                archiveStatus: expect.objectContaining({
                    state: 'failed',
                    error: 'User not authenticated with Google for gmail',
                    messageId: 'msg-1',
                }),
            }),
        })
    })

    test('skips already archived Gmail-origin tasks', async () => {
        await archiveGmailTaskIfNeeded('project-1', 'task-1', baseTask, {
            ...baseTask,
            done: true,
            gmailData: {
                ...baseTask.gmailData,
                archiveStatus: {
                    state: 'completed',
                },
            },
        })

        expect(getAccessToken).not.toHaveBeenCalled()
        expect(admin.__mock.update).not.toHaveBeenCalled()
    })

    test('archives Gmail-origin message when task is postponed', async () => {
        const modify = jest.fn(() => Promise.resolve())
        const setCredentials = jest.fn()

        getAccessToken.mockResolvedValue('token-1')
        getOAuth2Client.mockReturnValue({ setCredentials })
        google.gmail.mockReturnValue({
            users: {
                messages: {
                    modify,
                },
            },
        })

        await archiveGmailTaskIfNeeded('project-1', 'task-1', baseTask, {
            ...baseTask,
            dueDate: 2000,
        })

        expect(getAccessToken).toHaveBeenCalledWith('user-1', 'gmail-project', 'gmail')
        expect(modify).toHaveBeenCalledWith({
            userId: 'me',
            id: 'msg-1',
            requestBody: {
                removeLabelIds: ['INBOX'],
            },
        })
        expect(admin.__mock.update).toHaveBeenCalledWith({
            gmailData: expect.objectContaining({
                archiveStatus: expect.objectContaining({
                    state: 'completed',
                    messageId: 'msg-1',
                }),
            }),
        })
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
