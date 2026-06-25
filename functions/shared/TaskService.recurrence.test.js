const { TaskService } = require('./TaskService')
const { TASK_NAME_MAX_LENGTH } = require('./TaskValidator')

describe('TaskService recurrence updates', () => {
    let taskService

    beforeEach(async () => {
        taskService = new TaskService({
            enableFeeds: false,
        })
        await taskService.initialize()
    })

    test('updates a task recurrence', async () => {
        const result = await taskService.updateTask({
            taskId: 'task-1',
            projectId: 'project-1',
            currentTask: {
                id: 'task-1',
                name: 'Weekly review',
                recurrence: 'never',
                userId: 'user-1',
            },
            recurrence: 'weekly',
        })

        expect(result.updateData).toMatchObject({
            recurrence: 'weekly',
        })
        expect(result.changes).toContain('recurrence to "weekly"')
    })

    test('resets recurrence counters when recurrence is disabled', async () => {
        const result = await taskService.updateTask({
            taskId: 'task-1',
            projectId: 'project-1',
            currentTask: {
                id: 'task-1',
                name: 'Weekly review',
                recurrence: 'weekly',
                timesDoneInExpectedDay: 2,
                timesDone: 5,
                userId: 'user-1',
            },
            recurrence: 'never',
        })

        expect(result.updateData).toMatchObject({
            recurrence: 'never',
            timesDoneInExpectedDay: 0,
            timesDone: 0,
        })
    })

    test('rejects unsupported recurrence values', async () => {
        await expect(
            taskService.updateTask({
                taskId: 'task-1',
                projectId: 'project-1',
                currentTask: {
                    id: 'task-1',
                    name: 'Weekly review',
                    recurrence: 'never',
                    userId: 'user-1',
                },
                recurrence: 'sometimes',
            })
        ).rejects.toThrow('Invalid recurrence')
    })
})

describe('TaskService task name normalization', () => {
    let taskService

    beforeEach(async () => {
        taskService = new TaskService({
            enableFeeds: false,
            idGenerator: () => 'task-1',
        })
        await taskService.initialize()
    })

    test('abbreviates task names that exceed the creation limit', async () => {
        const longName = 'A'.repeat(TASK_NAME_MAX_LENGTH + 1)

        const result = await taskService.createTask(
            {
                name: longName,
                userId: 'user-1',
                projectId: 'project-1',
            },
            {
                userId: 'user-1',
                projectId: 'project-1',
            }
        )

        expect(result.task.name).toHaveLength(TASK_NAME_MAX_LENGTH)
        expect(result.task.name.endsWith('...')).toBe(true)
        expect(result.task.extendedName).toBe(result.task.name)
    })

    test('still rejects empty task names', async () => {
        await expect(
            taskService.createTask({
                name: ' '.repeat(TASK_NAME_MAX_LENGTH + 1),
                userId: 'user-1',
                projectId: 'project-1',
            })
        ).rejects.toThrow('Task name cannot be empty')
    })
})
