jest.mock('./backends/firestore', () => ({
    generateSortIndex: jest.fn(() => 1),
    getDb: jest.fn(),
    getId: jest.fn(() => 'task-id'),
    updateStatistics: jest.fn(),
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

import { calculateDayRateTimeLogAdjustment, DAY_RATE_TIME_LOG_TYPE, isDayRateTimeLogTask } from './DayRateTimeLogHelper'

const task = estimation => ({
    parentId: null,
    estimations: { Open: estimation },
})

const calendarTask = estimation => ({
    parentId: null,
    calendarData: { id: 'calendar-event' },
    estimations: { Open: estimation },
})

describe('DayRateTimeLogHelper', () => {
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
})
