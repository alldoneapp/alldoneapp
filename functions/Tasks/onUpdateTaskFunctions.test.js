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
                FieldValue: {
                    arrayUnion: jest.fn(value => ({ arrayUnion: value })),
                    arrayRemove: jest.fn(value => ({ arrayRemove: value })),
                    delete: jest.fn(() => ({ delete: true })),
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

jest.mock('./taskStatusFeed', () => ({
    persistTaskStatusFeed: jest.fn(() => Promise.resolve(false)),
}))

jest.mock('../Assistant/taskPriorityLearning', () => ({
    captureTaskPriorityTaskUpdateFeedback: jest.fn(() => Promise.resolve()),
}))

jest.mock('./workflowAiStep', () => ({
    enqueueWorkflowAiRunIfNeeded: jest.fn(() => Promise.resolve()),
}))

jest.mock('./workflowFocusHandoff', () => ({
    releaseFocusTaskOnWorkflowStepChange: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Repositories/taskMergeStatusReconciliation', () => ({
    reconcileTaskMergeStatusAfterWorkflowChange: jest.fn(() => Promise.resolve()),
}))

jest.mock('./taskStatusStatistics', () => ({
    persistCrossUserTaskStatusStatistics: jest.fn(() => Promise.resolve(false)),
}))

const admin = require('firebase-admin')
const { buildTaskProgressReward, finalizeAssistantScheduleSource, onUpdateTask } = require('./onUpdateTaskFunctions')
const { createRecurringTaskInCloudFunction } = require('./recurringTasksCloud')

describe('onUpdateTask recurring task completion', () => {
    const buildTask = overrides => ({
        name: 'Eltern anrufen / melden',
        userId: 'owner-1',
        userIds: ['owner-1'],
        assigneeType: 'USER',
        assistantId: '',
        isAssistantEnabled: false,
        recurrence: 'weekly',
        done: false,
        inDone: false,
        stepHistory: ['open'],
        lockKey: '',
        ...overrides,
    })

    const updateTask = (oldTask, newTask) =>
        onUpdateTask('task-1', 'project-1', {
            before: { data: () => oldTask },
            after: { data: () => newTask },
        })

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test.each([
        ['without a chat assistant', {}],
        ['with an attached chat assistant disabled', { assistantId: 'assistant-1' }],
        ['with an attached chat assistant enabled', { assistantId: 'assistant-1', isAssistantEnabled: true }],
        ['with a legacy missing assignee type', { assistantId: 'assistant-1', assigneeType: undefined }],
    ])('creates the next weekly occurrence for a human task %s', async (_, overrides) => {
        const oldTask = buildTask(overrides)
        const newTask = { ...oldTask, done: true, inDone: true }

        await updateTask(oldTask, newTask)

        expect(createRecurringTaskInCloudFunction).toHaveBeenCalledTimes(1)
        expect(createRecurringTaskInCloudFunction).toHaveBeenCalledWith('project-1', 'task-1', newTask)
    })

    test.each(['assistant', 'ASSISTANT'])(
        'leaves %s-owned task recurrence to the assistant scheduler',
        async assigneeType => {
            const oldTask = buildTask({ assigneeType, userId: 'assistant-1', userIds: ['assistant-1'] })

            await updateTask(oldTask, { ...oldTask, done: true, inDone: true })

            expect(createRecurringTaskInCloudFunction).not.toHaveBeenCalled()
        }
    )

    test.each([
        ['recurrence is disabled', { recurrence: 'never' }, {}],
        ['the completed task is edited again', { done: true, inDone: true }, {}],
        ['the task is still open', {}, { done: false, inDone: false }],
        ['the task has multiple assignees', { userIds: ['owner-1', 'reviewer-1'] }, {}],
    ])('does not create an occurrence when %s', async (_, oldOverrides, newOverrides) => {
        const oldTask = buildTask({ assistantId: 'assistant-1', ...oldOverrides })

        await updateTask(oldTask, { ...oldTask, done: true, inDone: true, ...newOverrides })

        expect(createRecurringTaskInCloudFunction).not.toHaveBeenCalled()
    })
})

describe('scheduled assistant task completion', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('advances the schedule only when its generated workflow task reaches done', async () => {
        await finalizeAssistantScheduleSource(
            { done: false },
            {
                id: 'generated-task-1',
                done: true,
                assistantScheduleSource: {
                    projectId: 'assistant-project',
                    assistantId: 'assistant-1',
                    taskId: 'schedule-1',
                    activatorUserId: 'user-1',
                    recurrence: 'weekly',
                },
            }
        )

        expect(admin.__mock.doc).toHaveBeenCalledWith('assistantTasks/assistant-project/assistant-1/schedule-1')
        expect(admin.__mock.update).toHaveBeenCalledWith(
            expect.objectContaining({
                executionStatus: 'succeeded',
                lastGeneratedTaskId: 'generated-task-1',
                'executionByUser.user-1': expect.objectContaining({
                    status: 'succeeded',
                    taskId: 'generated-task-1',
                }),
            })
        )
    })
})

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
