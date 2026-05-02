const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockDocUpdate = jest.fn()
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})

jest.mock('./backends/firestore', () => ({
    generateSortIndex: jest.fn(() => 1),
    getDb: jest.fn(),
    getId: jest.fn(() => 'task-id'),
    updateStatistics: jest.fn(),
}))

jest.mock('../functions/BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        set: mockBatchSet,
        update: mockBatchUpdate,
        commit: mockBatchCommit,
    })),
}))

jest.mock('../redux/store', () => ({
    getState: jest.fn(() => ({ loggedUser: { uid: 'user-1' } })),
}))

jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(),
}))

jest.mock('../components/TaskListView/Utils/TasksHelper', () => ({
    DONE_STEP: 'Done',
    OPEN_STEP: 'Open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_USER_TYPE: 'USER',
}))

import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import moment from 'moment-timezone'
import { getDb, updateStatistics } from './backends/firestore'
import {
    calculateDayRateTimeLogAdjustment,
    DAY_RATE_BACKFILL_VERSION,
    DAY_RATE_TIME_LOG_TASK_NAME,
    DAY_RATE_TIME_LOG_TYPE,
    getDayRateTimeLogRange,
    getDayRateTaskEstimation,
    isDayRateTimeLogTask,
    normalizeDayRateTimezoneOffset,
    reconcileDayRateTimeLog,
    reconcileProjectDayRateTimeLogsBackfill,
} from './DayRateTimeLogHelper'

const task = estimation => ({
    parentId: null,
    estimations: { Open: estimation },
})

const calendarTask = estimation => ({
    parentId: null,
    calendarData: { id: 'calendar-event' },
    estimations: { Open: estimation },
})

const storedTask = (estimation, data = {}) => ({
    ...task(estimation),
    userId: 'user-1',
    done: true,
    inDone: true,
    ...data,
})

const storedCalendarTask = (estimation, data = {}) => ({
    ...calendarTask(estimation),
    userId: 'user-1',
    done: true,
    inDone: true,
    ...data,
})

const createMockDb = (tasks, statisticsByPath = {}) => {
    const getDefaultStatistics = path => {
        if (!path.startsWith('statistics/')) return null

        const [, , userId, dateKey] = path.split('/')
        const doneTime = tasks
            .filter(task => task.userId === userId && task.done === true && task.inDone === true)
            .filter(task => task.completed && moment(task.completed).format('DDMMYYYY') === dateKey)
            .reduce((total, task) => total + getDayRateTaskEstimation(task), 0)

        return doneTime > 0 ? { doneTime } : null
    }

    const createQuery = () => {
        const filters = []
        const query = {
            where: jest.fn((field, operator, value) => {
                filters.push({ field, operator, value })
                return query
            }),
            orderBy: jest.fn(() => query),
            get: jest.fn().mockImplementation(async () => ({
                docs: tasks
                    .filter(task =>
                        filters.every(({ field, operator, value }) => {
                            switch (operator) {
                                case '==':
                                    return task[field] === value
                                case '>=':
                                    return task[field] >= value
                                case '<=':
                                    return task[field] <= value
                                default:
                                    return true
                            }
                        })
                    )
                    .map((task, index) => ({
                        id: task.id || `task-${index}`,
                        data: () => task,
                    })),
            })),
        }
        return query
    }
    return {
        collection: jest.fn(() => createQuery()),
        doc: jest.fn(path => {
            const statistics = Object.prototype.hasOwnProperty.call(statisticsByPath, path)
                ? statisticsByPath[path]
                : getDefaultStatistics(path)
            return {
                path,
                update: mockDocUpdate,
                get: jest.fn(async () => ({
                    exists: !!statistics,
                    data: () => statistics,
                })),
            }
        }),
    }
}

describe('DayRateTimeLogHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockBatchCommit.mockResolvedValue(undefined)
        mockDocUpdate.mockResolvedValue(undefined)
    })

    afterAll(() => {
        mockConsoleLog.mockRestore()
    })

    it('tops up qualifying days to the configured target', () => {
        const result = calculateDayRateTimeLogAdjustment([task(0), task(0), task(0), task(0), calendarTask(90)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.realDoneTasksAmount).toBe(5)
        expect(result.realLoggedMinutes).toBe(90)
        expect(result.adjustmentMinutes).toBe(390)
    })

    it('does not double count existing day-rate adjustment tasks', () => {
        const result = calculateDayRateTimeLogAdjustment(
            [
                calendarTask(60),
                calendarTask(60),
                calendarTask(60),
                calendarTask(60),
                calendarTask(60),
                { parentId: null, genericData: { type: DAY_RATE_TIME_LOG_TYPE }, estimations: { Open: 180 } },
            ],
            { enabled: true, targetMinutes: 480, triggerTasks: 5 }
        )

        expect(result.realDoneTasksAmount).toBe(5)
        expect(result.realLoggedMinutes).toBe(300)
        expect(result.adjustmentMinutes).toBe(180)
    })

    it('does not create automatic adjustments below the task threshold', () => {
        const result = calculateDayRateTimeLogAdjustment([calendarTask(60), calendarTask(30)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.shouldLogDay).toBe(false)
        expect(result.adjustmentMinutes).toBe(0)
    })

    it('allows manual worked-day adjustments below the task threshold', () => {
        const result = calculateDayRateTimeLogAdjustment(
            [task(60), task(30)],
            { enabled: true, targetMinutes: 480, triggerTasks: 5 },
            true
        )

        expect(result.shouldLogDay).toBe(true)
        expect(result.adjustmentMinutes).toBe(390)
    })

    it('does not produce a top-up when real logged time reaches the target', () => {
        const result = calculateDayRateTimeLogAdjustment(
            [calendarTask(120), calendarTask(120), calendarTask(120), calendarTask(60), calendarTask(60)],
            {
                enabled: true,
                targetMinutes: 480,
                triggerTasks: 5,
            }
        )

        expect(result.shouldLogDay).toBe(true)
        expect(result.adjustmentMinutes).toBe(0)
    })

    it('does not auto-adjust when a non-calendar task has manually logged time', () => {
        const result = calculateDayRateTimeLogAdjustment([task(240), task(0), task(0), task(0), calendarTask(30)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.hasManualNonCalendarLoggedTime).toBe(true)
        expect(result.shouldLogDay).toBe(false)
        expect(result.adjustmentMinutes).toBe(0)
    })

    it('still allows manual worked-day adjustments when a non-calendar task has logged time', () => {
        const result = calculateDayRateTimeLogAdjustment(
            [task(240), task(0)],
            { enabled: true, targetMinutes: 480, triggerTasks: 5 },
            true
        )

        expect(result.hasManualNonCalendarLoggedTime).toBe(true)
        expect(result.shouldLogDay).toBe(true)
        expect(result.adjustmentMinutes).toBe(240)
    })

    it('recognizes generated day-rate tasks', () => {
        expect(isDayRateTimeLogTask({ genericData: { type: DAY_RATE_TIME_LOG_TYPE } })).toBe(true)
        expect(isDayRateTimeLogTask(task(60))).toBe(false)
    })

    it('reads calendar task estimations from open-step aliases', () => {
        expect(getDayRateTaskEstimation({ estimations: { Open: 30 } })).toBe(30)
        expect(getDayRateTaskEstimation({ estimations: { open: 45 } })).toBe(45)
        expect(getDayRateTaskEstimation({ estimations: { '-1': 60 } })).toBe(60)
        expect(getDayRateTaskEstimation({ estimations: { '-1': '90' } })).toBe(90)
    })

    it('tops up against all visible calendar estimation aliases', () => {
        const result = calculateDayRateTimeLogAdjustment(
            [calendarTask(60), { parentId: null, calendarData: { id: 'calendar-event-2' }, estimations: { open: 30 } }],
            { enabled: true, targetMinutes: 480, triggerTasks: 5 },
            true
        )

        expect(result.realLoggedMinutes).toBe(90)
        expect(result.adjustmentMinutes).toBe(390)
    })

    it('normalizes stored timezone offsets to minutes', () => {
        expect(normalizeDayRateTimezoneOffset(2)).toBe(120)
        expect(normalizeDayRateTimezoneOffset(90)).toBe(90)
        expect(normalizeDayRateTimezoneOffset('+02:30')).toBe(150)
        expect(normalizeDayRateTimezoneOffset('UTC-05')).toBe(-300)
    })

    it('builds day ranges in the requested IANA timezone', () => {
        const timestamp = Date.UTC(2026, 2, 31, 22, 30, 0)
        const range = getDayRateTimeLogRange(timestamp, 'Europe/Berlin')

        expect(range.dayKey).toBe('20260401')
        expect(range.start).toBe(moment.tz('2026-04-01 00:00:00.000', 'Europe/Berlin').valueOf())
        expect(range.end).toBe(moment.tz('2026-04-01 23:59:59.999', 'Europe/Berlin').valueOf())
    })

    it('creates a missing generated task when a day newly qualifies', async () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })
        getDb.mockReturnValue(
            createMockDb([
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedCalendarTask(90, { completed }),
                storedTask(240, { completed, userId: 'user-2' }),
                storedTask(240, { completed, done: false }),
            ])
        )

        const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

        expect(result).toEqual({
            adjustmentMinutes: 390,
            realDoneTasksAmount: 5,
            realLoggedMinutes: 90,
            updated: true,
        })
        expect(mockBatchSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'items/project-1/tasks/dayRateTimeLog_user-1_20260501' }),
            expect.objectContaining({
                name: DAY_RATE_TIME_LOG_TASK_NAME,
                completed,
                done: true,
                estimations: { Open: 390 },
                genericData: {
                    type: DAY_RATE_TIME_LOG_TYPE,
                    projectId: 'project-1',
                    day: '20260501',
                    manual: false,
                },
            })
        )
        expect(updateStatistics).toHaveBeenCalledWith(
            'project-1',
            'user-1',
            390,
            false,
            true,
            completed,
            expect.anything()
        )
    })

    it('repairs statistics when task minutes and stored stats differ', async () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })
        getDb.mockReturnValue(
            createMockDb(
                [
                    storedTask(0, { completed }),
                    storedTask(0, { completed }),
                    storedTask(0, { completed }),
                    storedTask(0, { completed }),
                    storedCalendarTask(90, { completed }),
                ],
                {
                    'statistics/project-1/user-1/01052026': { doneTime: 60 },
                }
            )
        )

        const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

        expect(result).toEqual({
            adjustmentMinutes: 390,
            realDoneTasksAmount: 5,
            realLoggedMinutes: 90,
            updated: true,
        })
        expect(mockBatchSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'items/project-1/tasks/dayRateTimeLog_user-1_20260501' }),
            expect.objectContaining({
                estimations: { Open: 390 },
            })
        )
        expect(updateStatistics).toHaveBeenCalledWith(
            'project-1',
            'user-1',
            390,
            false,
            true,
            completed,
            expect.anything()
        )
        expect(updateStatistics).toHaveBeenCalledWith(
            'project-1',
            'user-1',
            30,
            false,
            true,
            completed,
            expect.anything()
        )
    })

    it('uses the timezone day when creating generated task ids', async () => {
        const completed = Date.UTC(2026, 2, 31, 22, 30, 0)
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })
        getDb.mockReturnValue(
            createMockDb([
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedCalendarTask(90, { completed }),
            ])
        )

        const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed, {
            timezone: 'Europe/Berlin',
        })

        expect(result).toEqual({
            adjustmentMinutes: 390,
            realDoneTasksAmount: 5,
            realLoggedMinutes: 90,
            updated: true,
        })
        expect(mockBatchSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'items/project-1/tasks/dayRateTimeLog_user-1_20260401' }),
            expect.objectContaining({
                completed,
                genericData: expect.objectContaining({
                    day: '20260401',
                }),
            })
        )
    })

    it('repairs existing generated task visibility when updating it', async () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })
        getDb.mockReturnValue(
            createMockDb([
                storedCalendarTask(90, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(0, { completed }),
                storedTask(420, {
                    id: 'dayRateTimeLog_user-1_20260501',
                    completed,
                    genericData: { type: DAY_RATE_TIME_LOG_TYPE },
                    isPublicFor: [],
                }),
            ])
        )

        await reconcileDayRateTimeLog('project-1', 'user-1', completed, { manual: true })

        expect(mockBatchUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'items/project-1/tasks/dayRateTimeLog_user-1_20260501' }),
            expect.objectContaining({
                userId: 'user-1',
                userIds: ['user-1'],
                currentReviewerId: 'Done',
                done: true,
                inDone: true,
                isPrivate: true,
                isPublicFor: ['user-1'],
                parentId: null,
                parentDone: false,
                isSubtask: false,
                'genericData.type': DAY_RATE_TIME_LOG_TYPE,
                'genericData.projectId': 'project-1',
                'genericData.day': '20260501',
                'genericData.manual': true,
            })
        )
    })

    it('backfills from the project start once and stores the backfill cursor', async () => {
        const projectStartDate = Date.UTC(2026, 3, 28, 12, 0, 0)
        const qualifyingDay = Date.UTC(2026, 3, 29, 12, 0, 0)
        const endTimestamp = Date.UTC(2026, 3, 30, 23, 59, 59)
        const db = createMockDb([
            storedTask(0, { completed: qualifyingDay }),
            storedTask(0, { completed: qualifyingDay }),
            storedTask(0, { completed: qualifyingDay }),
            storedTask(0, { completed: qualifyingDay }),
            storedCalendarTask(90, { completed: qualifyingDay }),
        ])
        getDb.mockReturnValue(db)
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })

        const results = await reconcileProjectDayRateTimeLogsBackfill(
            {
                id: 'project-1',
                projectStartDate,
                dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
            },
            'user-1',
            Date.UTC(2026, 3, 30, 12, 0, 0),
            endTimestamp
        )

        expect(results).toEqual([
            {
                adjustmentMinutes: 390,
                realDoneTasksAmount: 5,
                realLoggedMinutes: 90,
                updated: true,
            },
        ])
        expect(mockDocUpdate).toHaveBeenCalledWith({
            'dayRateTimeLog.backfilledUntilByUser.user-1': moment(endTimestamp).endOf('day').valueOf(),
            'dayRateTimeLog.backfillVersionByUser.user-1': DAY_RATE_BACKFILL_VERSION,
        })
    })

    it('ignores an old backfill cursor when the backfill version is missing', async () => {
        const projectStartDate = Date.UTC(2026, 3, 28, 12, 0, 0)
        const qualifyingDay = Date.UTC(2026, 3, 29, 12, 0, 0)
        const endTimestamp = Date.UTC(2026, 3, 30, 23, 59, 59)
        getDb.mockReturnValue(
            createMockDb([
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedCalendarTask(90, { completed: qualifyingDay }),
            ])
        )
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })

        const results = await reconcileProjectDayRateTimeLogsBackfill(
            {
                id: 'project-1',
                projectStartDate,
                dayRateTimeLog: {
                    enabled: true,
                    targetMinutes: 480,
                    triggerTasks: 5,
                    backfilledUntilByUser: {
                        'user-1': Date.UTC(2026, 3, 30, 23, 59, 59),
                    },
                },
            },
            'user-1',
            Date.UTC(2026, 3, 30, 12, 0, 0),
            endTimestamp
        )

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
            adjustmentMinutes: 390,
            realDoneTasksAmount: 5,
            updated: true,
        })
        expect(mockDocUpdate).toHaveBeenCalledWith({
            'dayRateTimeLog.backfilledUntilByUser.user-1': moment(endTimestamp).endOf('day').valueOf(),
            'dayRateTimeLog.backfillVersionByUser.user-1': DAY_RATE_BACKFILL_VERSION,
        })
    })

    it('can force a backfill from project start even when a cursor exists', async () => {
        const projectStartDate = Date.UTC(2026, 3, 28, 12, 0, 0)
        const qualifyingDay = Date.UTC(2026, 3, 29, 12, 0, 0)
        const endTimestamp = Date.UTC(2026, 3, 30, 23, 59, 59)
        getDb.mockReturnValue(
            createMockDb([
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedTask(0, { completed: qualifyingDay }),
                storedCalendarTask(90, { completed: qualifyingDay }),
            ])
        )
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })

        const results = await reconcileProjectDayRateTimeLogsBackfill(
            {
                id: 'project-1',
                projectStartDate,
                dayRateTimeLog: {
                    enabled: true,
                    targetMinutes: 480,
                    triggerTasks: 5,
                    backfilledUntilByUser: {
                        'user-1': Date.UTC(2026, 3, 30, 23, 59, 59),
                    },
                },
            },
            'user-1',
            Date.UTC(2026, 3, 30, 12, 0, 0),
            endTimestamp,
            { forceFromProjectStart: true }
        )

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
            adjustmentMinutes: 390,
            realDoneTasksAmount: 5,
            updated: true,
        })
    })
})
