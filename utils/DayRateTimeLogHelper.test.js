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

describe('DayRateTimeLogHelper', () => {
    it('tops up qualifying days to the configured target', () => {
        const result = calculateDayRateTimeLogAdjustment([task(15), task(15), task(15), task(15), task(30)], {
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
                task(60),
                task(60),
                task(60),
                task(60),
                task(60),
                { parentId: null, genericData: { type: DAY_RATE_TIME_LOG_TYPE }, estimations: { Open: 180 } },
            ],
            { enabled: true, targetMinutes: 480, triggerTasks: 5 }
        )

        expect(result.realDoneTasksAmount).toBe(5)
        expect(result.realLoggedMinutes).toBe(300)
        expect(result.adjustmentMinutes).toBe(180)
    })

    it('does not create automatic adjustments below the task threshold', () => {
        const result = calculateDayRateTimeLogAdjustment([task(60), task(30)], {
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
        const result = calculateDayRateTimeLogAdjustment([task(120), task(120), task(120), task(60), task(60)], {
            enabled: true,
            targetMinutes: 480,
            triggerTasks: 5,
        })

        expect(result.shouldLogDay).toBe(true)
        expect(result.adjustmentMinutes).toBe(0)
    })

    it('recognizes generated day-rate tasks', () => {
        expect(isDayRateTimeLogTask({ genericData: { type: DAY_RATE_TIME_LOG_TYPE } })).toBe(true)
        expect(isDayRateTimeLogTask(task(60))).toBe(false)
    })
})
