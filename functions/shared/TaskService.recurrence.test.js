const { TaskService } = require('./TaskService')

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
