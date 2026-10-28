const {
    shouldSaveRecurrenceOriginalDueDate,
    getRecurrenceOriginalDueDateUpdate,
} = require('./recurrenceOriginalDueDate')
const { TaskService } = require('./TaskService')

// AT-2803: postponing a recurring task keeps the date it was originally planned for.
describe('recurrenceOriginalDueDate', () => {
    const PLANNED = 1793055600000
    const LATER = PLANNED + 3 * 24 * 60 * 60 * 1000
    const recurring = { recurrence: 'weekly', dueDate: PLANNED }

    test('the first postponement of a recurring task stores the planned date', () => {
        expect(getRecurrenceOriginalDueDateUpdate(recurring, PLANNED, LATER)).toEqual({
            recurrenceOriginalDueDate: PLANNED,
        })
    })

    test('a later postponement never overwrites the original', () => {
        const postponed = { ...recurring, dueDate: LATER, recurrenceOriginalDueDate: PLANNED }
        expect(getRecurrenceOriginalDueDateUpdate(postponed, LATER, LATER + 1000)).toEqual({})
    })

    test('moving a task earlier, a non-recurring task and observer dates store nothing', () => {
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, LATER, PLANNED)).toBe(false)
        expect(shouldSaveRecurrenceOriginalDueDate({ recurrence: 'never' }, PLANNED, LATER)).toBe(false)
        expect(shouldSaveRecurrenceOriginalDueDate({}, PLANNED, LATER)).toBe(false)
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, PLANNED, LATER, { isObservedTask: true })).toBe(false)
    })

    test('object-shaped recurrence and a recurrence changed in the same update are honoured', () => {
        expect(shouldSaveRecurrenceOriginalDueDate({ recurrence: { type: 'daily' } }, PLANNED, LATER)).toBe(true)
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, PLANNED, LATER, { recurrence: 'never' })).toBe(false)
        expect(
            shouldSaveRecurrenceOriginalDueDate({ recurrence: 'never' }, PLANNED, LATER, { recurrence: 'daily' })
        ).toBe(true)
    })

    test('missing or non-numeric dates store nothing', () => {
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, null, LATER)).toBe(false)
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, PLANNED, undefined)).toBe(false)
        expect(shouldSaveRecurrenceOriginalDueDate(recurring, 'soon', LATER)).toBe(false)
    })
})

describe('TaskService.updateTask keeps the original date of a postponed recurring task', () => {
    const PLANNED = 1793055600000
    const LATER = PLANNED + 2 * 24 * 60 * 60 * 1000
    const buildService = async () => {
        const service = new TaskService({ enableFeeds: false })
        await service.initialize()
        return service
    }

    test('an assistant/MCP postponement stamps recurrenceOriginalDueDate', async () => {
        const service = await buildService()
        const currentTask = { id: 't', name: 'Weekly review', userId: 'u', dueDate: PLANNED, recurrence: 'weekly' }

        const result = await service.updateTask({ taskId: 't', projectId: 'p', currentTask, dueDate: LATER })

        expect(result.updateData.dueDate).toBe(LATER)
        expect(result.updateData.recurrenceOriginalDueDate).toBe(PLANNED)
    })

    test('a non-recurring task and an already-stamped task are left alone', async () => {
        const service = await buildService()
        const plain = { id: 't', name: 'Once', userId: 'u', dueDate: PLANNED, recurrence: 'never' }
        const stamped = { ...plain, recurrence: 'weekly', dueDate: LATER, recurrenceOriginalDueDate: PLANNED }

        const plainResult = await service.updateTask({
            taskId: 't',
            projectId: 'p',
            currentTask: plain,
            dueDate: LATER,
        })
        const stampedResult = await service.updateTask({
            taskId: 't',
            projectId: 'p',
            currentTask: stamped,
            dueDate: LATER + 1000,
        })

        expect(plainResult.updateData).not.toHaveProperty('recurrenceOriginalDueDate')
        expect(stampedResult.updateData).not.toHaveProperty('recurrenceOriginalDueDate')
    })

    test('resending the stored dueDate stamps nothing', async () => {
        const service = await buildService()
        const currentTask = { id: 't', name: 'Weekly review', userId: 'u', dueDate: PLANNED, recurrence: 'weekly' }

        const result = await service.updateTask({ taskId: 't', projectId: 'p', currentTask, dueDate: PLANNED })

        expect(result.updateData).toEqual({})
    })
})
