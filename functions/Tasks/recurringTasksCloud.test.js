const moment = require('moment')

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    getTaskNameWithoutMeta: text => text,
}))

const { calculateNextRecurrenceDate } = require('./recurringTasksCloud')

describe('recurringTasksCloud recurrence base dates', () => {
    const buildTask = overrides => ({
        recurrence: 'daily',
        created: moment('2026-06-01T09:00:00').valueOf(),
        startDate: moment('2026-06-01T09:00:00').valueOf(),
        startTime: '09:00',
        completed: moment('2026-06-08T10:00:00').valueOf(),
        ...overrides,
    })

    test('keeps current-date behavior when no override is provided', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'daily' }), now)

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-09 09:00')
    })

    test('uses current-date override as the base date', () => {
        const currentDate = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: currentDate,
            }),
            currentDate
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-15 09:00')
    })

    test('preserves original weekly cadence after postponed completion', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-06-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: originalDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-15 09:00')
    })

    test('uses a custom date override', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const customDate = moment('2026-06-10T00:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: customDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-17 09:00')
    })

    test('adds the custom day interval with current-date behavior', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'custom:28' }), now)

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-07-06 09:00')
    })

    test('advances stale custom anchors to the next future occurrence', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-05-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'custom:10',
                recurrenceBaseDateOverride: originalDate,
                completed: now,
            }),
            now
        )

        // 2026-05-01 + 10-day steps: 05-11, 05-21, 05-31, 06-10 (first strictly after 06-08)
        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-10 09:00')
    })

    test('returns null for an invalid custom value', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'custom:0' }), now)

        expect(nextDate).toBeNull()
    })

    test('advances stale monthly anchors to the next future occurrence', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-05-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'monthly',
                recurrenceBaseDateOverride: originalDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-07-01 09:00')
    })
})

describe('recurringTasksCloud goal privacy on the next occurrence', () => {
    // The completed task is cloned wholesale into TaskService, which builds the new document
    // through TaskModelBuilder. That builder used to hardcode `parentGoalIsPublicFor: null`
    // while letting `parentGoalId` through, so every recurrence copy pointed at its goal but
    // was filed under "no goal" by the open-task lists (and warned
    // `[OpenTasks] oldTask.parentGoalIsPublicFor missing/invalid` on its next edit).
    const persisted = []

    beforeEach(() => {
        persisted.length = 0
        jest.resetModules()
        jest.doMock('firebase-admin', () => ({
            firestore: () => ({
                collection: () => ({
                    doc: () => ({ get: async () => ({ exists: false }) }),
                }),
            }),
        }))
        jest.doMock('firebase-admin/firestore', () => ({ FieldValue: {} }))
        jest.doMock('../shared/TaskService', () => {
            const { createTaskObject } = jest.requireActual('../shared/TaskModelBuilder')
            class TaskService {
                async initialize() {}
                async createAndPersistTask(params) {
                    const task = createTaskObject({ ...params, taskId: 'next-occurrence' })
                    persisted.push(task)
                    return { success: true, taskId: task.id }
                }
            }
            return { TaskService }
        })
    })

    const completedTask = overrides => ({
        id: 'done-occurrence',
        name: 'check costs again',
        extendedName: 'Check costs again',
        userId: 'user-1',
        creatorId: 'user-1',
        userIds: ['user-1'],
        recurrence: 'weekly',
        created: moment('2026-08-18T06:04:00').valueOf(),
        startDate: moment('2026-08-18T06:04:00').valueOf(),
        dueDate: moment('2026-08-25T06:00:00').valueOf(),
        completed: moment('2026-08-25T06:01:00').valueOf(),
        parentGoalId: 'goal-1',
        parentGoalIsPublicFor: [0],
        lockKey: '',
        subtaskIds: [],
        ...overrides,
    })

    test('carries the completed task’s goal AND its privacy array into the new occurrence', async () => {
        const { createNewRecurringTask } = require('./recurringTasksCloud')

        const created = await createNewRecurringTask('project-1', completedTask(), moment('2026-09-01T06:00:00'))

        expect(created).toEqual(expect.objectContaining({ id: 'next-occurrence' }))
        expect(persisted).toHaveLength(1)
        expect(persisted[0].parentGoalId).toBe('goal-1')
        expect(persisted[0].parentGoalIsPublicFor).toEqual([0])
    })

    test('a private goal keeps its member list on the next occurrence', async () => {
        const { createNewRecurringTask } = require('./recurringTasksCloud')

        await createNewRecurringTask(
            'project-1',
            completedTask({ parentGoalIsPublicFor: ['user-1', 'user-9'] }),
            moment('2026-09-01T06:00:00')
        )

        expect(persisted[0].parentGoalIsPublicFor).toEqual(['user-1', 'user-9'])
    })

    test('a task without a goal still gets null', async () => {
        const { createNewRecurringTask } = require('./recurringTasksCloud')

        await createNewRecurringTask(
            'project-1',
            completedTask({ parentGoalId: null, parentGoalIsPublicFor: null }),
            moment('2026-09-01T06:00:00')
        )

        expect(persisted[0].parentGoalId).toBeNull()
        expect(persisted[0].parentGoalIsPublicFor).toBeNull()
    })
})
