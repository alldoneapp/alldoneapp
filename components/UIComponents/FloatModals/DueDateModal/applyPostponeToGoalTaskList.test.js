import { applyPostponeToGoalTaskList } from './applyPostponeToGoalTaskList'

// AT-2160
describe('applyPostponeToGoalTaskList', () => {
    const tasks = [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }]

    it('writes the goal reminder before any task write starts', async () => {
        const order = []
        await applyPostponeToGoalTaskList({
            tasks,
            updateGoalReminderDate: () => order.push('goal'),
            applyToTask: task => order.push(task.id),
        })
        expect(order).toEqual(['goal', 'task-1', 'task-2', 'task-3'])
    })

    // The regression this whole helper exists for: the old loop awaited each task's round trip
    // before starting the next, so a goal with N tasks took N round trips to clear.
    it('starts every task write without waiting for the previous one to settle', async () => {
        const started = []
        const release = []
        const promise = applyPostponeToGoalTaskList({
            tasks,
            applyToTask: task =>
                new Promise(resolve => {
                    started.push(task.id)
                    release.push(resolve)
                }),
        })

        // Nothing has resolved yet, but all three must already be in flight.
        await Promise.resolve()
        expect(started).toEqual(['task-1', 'task-2', 'task-3'])

        release.forEach(resolve => resolve())
        await promise
    })

    it('reports a failing task and still applies the rest', async () => {
        const applied = []
        const onTaskError = jest.fn()
        await applyPostponeToGoalTaskList({
            tasks,
            applyToTask: task => {
                if (task.id === 'task-2') throw new Error('boom')
                applied.push(task.id)
            },
            onTaskError,
        })

        expect(applied).toEqual(['task-1', 'task-3'])
        expect(onTaskError).toHaveBeenCalledTimes(1)
        expect(onTaskError).toHaveBeenCalledWith(tasks[1], expect.any(Error))
    })

    it('survives a rejected promise as well as a thrown error', async () => {
        const onTaskError = jest.fn()
        await applyPostponeToGoalTaskList({
            tasks: [{ id: 'task-1' }],
            applyToTask: () => Promise.reject(new Error('network')),
            onTaskError,
        })
        expect(onTaskError).toHaveBeenCalledWith({ id: 'task-1' }, expect.any(Error))
    })

    it('still moves the goal when there is no task writer', async () => {
        const updateGoalReminderDate = jest.fn()
        await applyPostponeToGoalTaskList({ tasks, updateGoalReminderDate, applyToTask: null })
        expect(updateGoalReminderDate).toHaveBeenCalledTimes(1)
    })

    it('does nothing harmful without a goal writer or tasks', async () => {
        await expect(applyPostponeToGoalTaskList({ tasks: [], applyToTask: jest.fn() })).resolves.toEqual([])
        await expect(applyPostponeToGoalTaskList({ applyToTask: jest.fn() })).resolves.toEqual([])
    })
})
