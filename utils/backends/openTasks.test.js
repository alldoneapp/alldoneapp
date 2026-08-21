const mockDispatch = jest.fn()

jest.mock('../../redux/store', () => ({
    dispatch: (...args) => mockDispatch(...args),
    getState: jest.fn(() => ({})),
}))

jest.mock('../../components/TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    BACKLOG_DATE_STRING: 'Someday',
}))

jest.mock('../../components/Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'default',
    WORKSTREAM_ID_PREFIX: 'ws_',
}))

jest.mock('../../components/GoalsView/GoalsHelper', () => ({
    BACKLOG_MILESTONE_ID: 'backlog',
    DYNAMIC_PERCENT: 'dynamic',
    getOwnerId: jest.fn(),
}))

jest.mock('../../components/HashtagFilters/FilterHelpers/FilterTasks', () => ({
    filterOpenTasks: jest.fn(tasks => tasks),
}))

jest.mock('../../components/TaskListView/PriorityFilters/taskPriorityFilterHelper', () => ({
    filterOpenTasksSectionsByPriority: jest.fn(tasks => tasks),
    filterOpenTasksSectionsByVmState: jest.fn(tasks => tasks),
}))

jest.mock('../EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: jest.fn((projectId, estimation) => estimation),
}))

import {
    AMOUNT_TASKS_INDEX,
    getTaskTypeIndex,
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
    taskBelongsInOpenBoard,
    taskToShowInAllProjects,
    WORKFLOW_TASK_INDEX,
} from './openTasks'

jest.mock('./firestore', () => ({
    getDb: jest.fn(),
    globalWatcherUnsub: {},
    mapGoalData: jest.fn(),
    mapMilestoneData: jest.fn(),
    mapTaskData: jest.fn(),
}))

describe('assistant profile open task selection', () => {
    it('includes active workflow tasks in the unified assistant profile timeline', () => {
        const workflowTask = { workflowTask: true }

        expect(taskBelongsInOpenBoard(workflowTask, true)).toBe(false)
        expect(taskBelongsInOpenBoard(workflowTask, true, false, true)).toBe(true)
        expect(taskBelongsInOpenBoard(workflowTask, true, true)).toBe(true)
    })

    it('flattens an active workflow task into the normal assistant timeline', () => {
        const workflowTaskWithHistory = {
            workflowTask: true,
            userIds: ['assistant-1', 'reviewer-2', 'assistant-1'],
        }

        expect(getTaskTypeIndex(workflowTaskWithHistory, false, false)).toBe(WORKFLOW_TASK_INDEX)
        expect(getTaskTypeIndex(workflowTaskWithHistory, false, false, true)).toBe(MAIN_TASK_INDEX)
    })
})

// AT-2252 - calendar and email tasks used to be routed into their own buckets, which is what put
// them into their own sections in the task list. They must now land in the normal list.
describe('calendar and email tasks in the normal task list', () => {
    const baseTask = { genericData: null, suggestedBy: null, userIds: ['user-1'] }

    it('puts a calendar task in the main task list', () => {
        const calendarTask = {
            ...baseTask,
            calendarData: { eventId: 'event-1', start: { dateTime: '2026-08-11T09:00:00Z' } },
        }

        expect(getTaskTypeIndex(calendarTask, false, false)).toBe(MAIN_TASK_INDEX)
    })

    it('puts an inbox summary email task in the main task list', () => {
        const emailTask = { ...baseTask, gmailData: { messageId: 'message-1' } }

        expect(getTaskTypeIndex(emailTask, false, false)).toBe(MAIN_TASK_INDEX)
    })

    it('still routes mention, workflow and suggested tasks to their own sections', () => {
        expect(getTaskTypeIndex({ ...baseTask, genericData: { type: 'mention' } }, false, false)).toBe(
            MENTION_TASK_INDEX
        )
        expect(getTaskTypeIndex({ ...baseTask, userIds: ['user-1', 'user-2'] }, false, false)).toBe(WORKFLOW_TASK_INDEX)
        expect(getTaskTypeIndex({ ...baseTask, suggestedBy: 'assistant-1' }, false, false)).toBe(SUGGESTED_TASK_INDEX)
    })

    it('keeps a calendar task out of the observed and stream sections', () => {
        const calendarTask = { ...baseTask, calendarData: { eventId: 'event-1' } }

        expect(getTaskTypeIndex(calendarTask, true, false)).toBe(OBSERVED_TASKS_INDEX)
        expect(getTaskTypeIndex(calendarTask, false, true)).toBe(STREAM_AND_USER_TASKS_INDEX)
    })
})

describe('All Projects open task selection', () => {
    const instanceKey = 'project-1_user-1'

    beforeEach(() => {
        mockDispatch.mockClear()
    })

    it('keeps suggested tasks visible and counts them in the project summary', () => {
        const suggestedTask = { id: 'suggested-task-1' }
        const tasksByDate = Array.from({ length: 11 }, () => [])
        tasksByDate[0] = '0'
        tasksByDate[SUGGESTED_TASK_INDEX] = [['assistant-1', [['0', [suggestedTask]]]]]

        const result = taskToShowInAllProjects(instanceKey, [tasksByDate])

        expect(result).toHaveLength(1)
        expect(result[0][SUGGESTED_TASK_INDEX]).toEqual(tasksByDate[SUGGESTED_TASK_INDEX])
        expect(result[0][AMOUNT_TASKS_INDEX]).toBe(1)
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'Update there are hidden not main tasks',
            instanceKey,
            thereAreHiddenNotMainTasks: false,
        })
    })

    it('continues hiding mentions, observed tasks, and stream tasks', () => {
        const tasksByDate = Array.from({ length: 11 }, () => [])
        tasksByDate[0] = '0'
        tasksByDate[MAIN_TASK_INDEX] = [['0', [{ id: 'main-task-1' }]]]
        tasksByDate[MENTION_TASK_INDEX] = [['user-2', [['0', [{ id: 'mention-task-1' }]]]]]
        tasksByDate[OBSERVED_TASKS_INDEX] = [['user-2', [['0', [{ id: 'observed-task-1' }]]]]]
        tasksByDate[STREAM_AND_USER_TASKS_INDEX] = [['user-2', [['0', [{ id: 'stream-task-1' }]]]]]

        const result = taskToShowInAllProjects(instanceKey, [tasksByDate])

        expect(result[0][MENTION_TASK_INDEX]).toEqual([])
        expect(result[0][OBSERVED_TASKS_INDEX]).toEqual([])
        expect(result[0][STREAM_AND_USER_TASKS_INDEX]).toEqual([])
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'Update there are hidden not main tasks',
            instanceKey,
            thereAreHiddenNotMainTasks: true,
        })
    })
})
