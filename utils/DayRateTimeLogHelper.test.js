const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockDocUpdate = jest.fn()
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})

jest.mock('./backends/firestore', () => ({
    generateSortIndex: jest.fn(() => 1),
    getDb: jest.fn(),
    getLoggedUserAccessReaderId: jest.fn(() => 'user-1'),
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
    getDayRateCappedMinutes,
    getDayRateTaskEstimation,
    isDayRateTimeLogTask,
    normalizeDayRateTimezoneOffset,
    reconcileDayRateTimeLog,
    reconcileExistingDayRateTimeLog,
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
    readerIds: ['user-1'],
    done: true,
    inDone: true,
    ...data,
})

const storedCalendarTask = (estimation, data = {}) => ({
    ...calendarTask(estimation),
    userId: 'user-1',
    readerIds: ['user-1'],
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
                                case 'array-contains':
                                    return Array.isArray(task[field]) && task[field].includes(value)
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

    it('uses the strict-rules reader projection for day task queries', async () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        const db = createMockDb([storedTask(30, { completed })])
        ProjectHelper.getProjectById.mockReturnValue({
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        })
        getDb.mockReturnValue(db)

        await reconcileDayRateTimeLog('project-1', 'user-1', completed)

        const tasksQuery = db.collection.mock.results[0].value
        expect(tasksQuery.where).toHaveBeenCalledWith('readerIds', 'array-contains', 'user-1')
    })

    it('does not query Firestore after an ordinary task completion when day-rate logging is disabled', async () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        const db = createMockDb([storedTask(30, { completed })])
        ProjectHelper.getProjectById.mockReturnValue({})
        getDb.mockReturnValue(db)

        await expect(reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)).resolves.toBeNull()

        expect(db.collection).not.toHaveBeenCalled()
        expect(mockBatchCommit).not.toHaveBeenCalled()
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

    it('caps calendar time above the target even when the day does not qualify for a top-up', () => {
        const result = calculateDayRateTimeLogAdjustment([calendarTask(240), calendarTask(240), calendarTask(120)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.shouldLogDay).toBe(false)
        expect(result.shouldCapDay).toBe(true)
        expect(result.shouldPinDay).toBe(true)
        expect(result.dayCeilingMinutes).toBe(480)
        expect(result.excessMinutes).toBe(120)
        expect(result.adjustmentMinutes).toBe(0)
    })

    it('keeps hand-logged non-calendar time above the target', () => {
        const result = calculateDayRateTimeLogAdjustment([task(360), task(240)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.manualNonCalendarMinutes).toBe(600)
        expect(result.dayCeilingMinutes).toBe(600)
        expect(result.excessMinutes).toBe(0)
        expect(result.shouldCapDay).toBe(false)
        expect(result.shouldPinDay).toBe(false)
    })

    it('raises the ceiling to the hand-logged time and trims only the calendar time above it', () => {
        expect(
            calculateDayRateTimeLogAdjustment([task(600), calendarTask(180)], { enabled: true, targetMinutes: 480 })
        ).toMatchObject({ realLoggedMinutes: 780, dayCeilingMinutes: 600, excessMinutes: 180, shouldCapDay: true })
        expect(
            calculateDayRateTimeLogAdjustment([task(120), calendarTask(540)], { enabled: true, targetMinutes: 480 })
        ).toMatchObject({ realLoggedMinutes: 660, dayCeilingMinutes: 480, excessMinutes: 180, shouldCapDay: true })
    })

    it('reports no excess for a day at or below the target', () => {
        expect(calculateDayRateTimeLogAdjustment([task(480)], { enabled: true, targetMinutes: 480 })).toMatchObject({
            excessMinutes: 0,
            shouldCapDay: false,
        })
        expect(calculateDayRateTimeLogAdjustment([task(60)], { enabled: true, targetMinutes: 480 })).toMatchObject({
            excessMinutes: 0,
            shouldCapDay: false,
            shouldPinDay: false,
        })
    })

    it('reads the trimmed minutes back off a generated task', () => {
        expect(getDayRateCappedMinutes({ genericData: { cappedMinutes: 120 } })).toBe(120)
        expect(getDayRateCappedMinutes({ genericData: { cappedMinutes: '30' } })).toBe(30)
        expect(getDayRateCappedMinutes({ genericData: { cappedMinutes: -5 } })).toBe(0)
        expect(getDayRateCappedMinutes({ genericData: {} })).toBe(0)
        expect(getDayRateCappedMinutes({})).toBe(0)
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

    it('counts date-only all-day calendar events as zero minutes', () => {
        expect(
            getDayRateTaskEstimation({
                calendarData: {
                    start: { date: '2026-07-13' },
                    end: { date: '2026-07-14' },
                },
                estimations: { Open: 480 },
            })
        ).toBe(0)
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
            cappedMinutes: 0,
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
                    cappedMinutes: 0,
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
            cappedMinutes: 0,
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
            cappedMinutes: 0,
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

    describe('day cap (calendar time never logs more than the target; hand-logged time is kept)', () => {
        const completed = Date.UTC(2026, 4, 1, 12, 0, 0)
        const anchorPath = 'items/project-1/tasks/dayRateTimeLog_user-1_20260501'
        const anchor = (estimation, genericData = {}) =>
            storedTask(estimation, {
                id: 'dayRateTimeLog_user-1_20260501',
                completed,
                genericData: { type: DAY_RATE_TIME_LOG_TYPE, manual: false, ...genericData },
            })
        const expectStatisticsWrite = (minutes, subtract) =>
            expect(updateStatistics).toHaveBeenCalledWith(
                'project-1',
                'user-1',
                minutes,
                subtract,
                true,
                completed,
                expect.anything()
            )

        beforeEach(() => {
            ProjectHelper.getProjectById.mockReturnValue({
                dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
            })
        })

        it('trims calendar time over the target on a day that never qualified for a top-up', async () => {
            // Three events, below the task trigger, so the top-up stands down. The cap must not.
            getDb.mockReturnValue(
                createMockDb([
                    storedCalendarTask(240, { completed }),
                    storedCalendarTask(240, { completed }),
                    storedCalendarTask(120, { completed }),
                ])
            )

            const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toEqual({
                adjustmentMinutes: 0,
                cappedMinutes: 120,
                realDoneTasksAmount: 3,
                realLoggedMinutes: 600,
                updated: true,
            })
            expect(mockBatchSet).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({
                    estimations: { Open: 0 },
                    genericData: expect.objectContaining({ type: DAY_RATE_TIME_LOG_TYPE, cappedMinutes: 120 }),
                })
            )
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(120, true)
        })

        it('trims a qualifying day over the target instead of only skipping the top-up', async () => {
            getDb.mockReturnValue(
                createMockDb([
                    storedCalendarTask(120, { completed }),
                    storedCalendarTask(120, { completed }),
                    storedCalendarTask(120, { completed }),
                    storedCalendarTask(120, { completed }),
                    storedCalendarTask(120, { completed }),
                ])
            )

            const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ adjustmentMinutes: 0, cappedMinutes: 120, updated: true })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(120, true)
        })

        it('keeps hand-logged non-calendar time above the target untouched', async () => {
            // Ten hours typed onto two tasks is the user's explicit record of the day: no generated
            // task, no statistics write, from either entry point.
            getDb.mockReturnValue(createMockDb([storedTask(360, { completed }), storedTask(240, { completed })]))

            await expect(reconcileDayRateTimeLog('project-1', 'user-1', completed)).resolves.toEqual({
                adjustmentMinutes: 0,
                cappedMinutes: 0,
                realDoneTasksAmount: 2,
                realLoggedMinutes: 600,
                updated: false,
            })
            await expect(reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)).resolves.toEqual({
                updated: false,
            })
            expect(mockBatchSet).not.toHaveBeenCalled()
            expect(mockBatchUpdate).not.toHaveBeenCalled()
            expect(updateStatistics).not.toHaveBeenCalled()
        })

        it('caps a mixed day at the hand-logged time rather than at the target', async () => {
            // 10h by hand plus a 3h calendar event: the hand-logged hours raise the ceiling to 10h,
            // and only the calendar time above it is trimmed.
            getDb.mockReturnValue(
                createMockDb([storedTask(600, { completed }), storedCalendarTask(180, { completed })])
            )

            const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ cappedMinutes: 180, realLoggedMinutes: 780, updated: true })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(180, true)
            expect(mockBatchSet).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({ genericData: expect.objectContaining({ cappedMinutes: 180 }) })
            )
        })

        it('lets calendar time fill only up to the target next to hand-logged time', async () => {
            // 2h by hand plus 9h of calendar events: the ceiling stays at the 8h target.
            getDb.mockReturnValue(
                createMockDb([storedTask(120, { completed }), storedCalendarTask(540, { completed })])
            )

            const result = await reconcileDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ cappedMinutes: 180, realLoggedMinutes: 660, updated: true })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(180, true)
        })

        it('applies the cap from the after-task-change path when the day has no generated task yet', async () => {
            // This is the path an ordinary estimation change takes, and it used to require a
            // generated task to exist before it would touch the day at all.
            getDb.mockReturnValue(
                createMockDb([
                    storedCalendarTask(240, { completed }),
                    storedCalendarTask(240, { completed }),
                    storedCalendarTask(120, { completed }),
                ])
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toEqual({
                adjustmentMinutes: 0,
                cappedMinutes: 120,
                realDoneTasksAmount: 3,
                realLoggedMinutes: 600,
                updated: true,
            })
            expect(mockBatchSet).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({
                    estimations: { Open: 0 },
                    genericData: expect.objectContaining({ cappedMinutes: 120 }),
                })
            )
            expectStatisticsWrite(120, true)
        })

        it('still leaves a day under the target alone when it has no generated task', async () => {
            getDb.mockReturnValue(
                createMockDb([storedCalendarTask(60, { completed }), storedCalendarTask(30, { completed })])
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toEqual({ updated: false })
            expect(mockBatchSet).not.toHaveBeenCalled()
            expect(mockBatchUpdate).not.toHaveBeenCalled()
            expect(updateStatistics).not.toHaveBeenCalled()
        })

        it('re-running a capped day writes no statistics but keeps remembering the trimmed minutes', async () => {
            getDb.mockReturnValue(
                createMockDb(
                    [
                        storedCalendarTask(360, { completed }),
                        storedCalendarTask(240, { completed }),
                        anchor(0, { cappedMinutes: 120 }),
                    ],
                    { 'statistics/project-1/user-1/01052026': { doneTime: 480 } }
                )
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ cappedMinutes: 120, updated: true })
            expect(updateStatistics).not.toHaveBeenCalled()
            expect(mockBatchUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({ 'estimations.Open': 0, 'genericData.cappedMinutes': 120 })
            )
        })

        it('gives the trimmed minutes back once the day drops under the target', async () => {
            // The day was capped at 480 with 600 calendar minutes. One event then shrank from 360
            // to 160: the estimation path already wrote -360 +160 to the statistics, so they stand
            // at 280 while the tasks add up to 400. Nothing qualifies the day for a top-up, so the
            // statistics must return to the task total, i.e. get the 120 back.
            getDb.mockReturnValue(
                createMockDb(
                    [
                        storedCalendarTask(160, { completed }),
                        storedCalendarTask(240, { completed }),
                        anchor(0, { cappedMinutes: 120 }),
                    ],
                    { 'statistics/project-1/user-1/01052026': { doneTime: 280 } }
                )
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toEqual({
                adjustmentMinutes: 0,
                cappedMinutes: 0,
                realDoneTasksAmount: 2,
                realLoggedMinutes: 400,
                updated: true,
            })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(120, false)
            expect(mockBatchUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({ 'genericData.cappedMinutes': 0 })
            )
        })

        it('gives the trimmed minutes back when hand-logged time raises the ceiling past them', async () => {
            // 600 calendar minutes capped at 480 (anchor remembers 120). The user then logs 10h by
            // hand on a task: the estimation path added 600 to the statistics (now 1080), the
            // ceiling is 600 and the tasks add up to 1200 — so the whole calendar time is now the
            // excess, and the statistics end at the hand-logged 600.
            getDb.mockReturnValue(
                createMockDb(
                    [
                        storedCalendarTask(360, { completed }),
                        storedCalendarTask(240, { completed }),
                        storedTask(600, { completed }),
                        anchor(0, { cappedMinutes: 120 }),
                    ],
                    { 'statistics/project-1/user-1/01052026': { doneTime: 1080 } }
                )
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ cappedMinutes: 600, realLoggedMinutes: 1200, updated: true })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(480, true)
        })

        it('re-trims to the new excess when a capped day shrinks but stays over the target', async () => {
            // 600 capped to 480, then one event shortened 360 -> 260: statistics now 380, tasks 500.
            getDb.mockReturnValue(
                createMockDb(
                    [
                        storedCalendarTask(260, { completed }),
                        storedCalendarTask(240, { completed }),
                        anchor(0, { cappedMinutes: 120 }),
                    ],
                    { 'statistics/project-1/user-1/01052026': { doneTime: 380 } }
                )
            )

            const result = await reconcileExistingDayRateTimeLog('project-1', 'user-1', completed)

            expect(result).toMatchObject({ cappedMinutes: 20, realLoggedMinutes: 500, updated: true })
            expect(updateStatistics).toHaveBeenCalledTimes(1)
            expectStatisticsWrite(100, false)
            expect(mockBatchUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ path: anchorPath }),
                expect.objectContaining({ 'genericData.cappedMinutes': 20 })
            )
        })
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
                cappedMinutes: 0,
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
            cappedMinutes: 0,
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
            cappedMinutes: 0,
            realDoneTasksAmount: 5,
            updated: true,
        })
    })
})
