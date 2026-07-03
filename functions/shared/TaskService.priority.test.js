const { TaskService } = require('./TaskService')

describe('TaskService priority updates', () => {
    let taskService

    beforeEach(async () => {
        taskService = new TaskService({ enableFeeds: false })
        await taskService.initialize()
    })

    test('updates and clears task priority', async () => {
        const currentTask = { id: 'task-1', name: 'Launch', priority: 'none', userId: 'user-1' }
        const prioritized = await taskService.updateTask({
            taskId: 'task-1',
            projectId: 'project-1',
            currentTask,
            priority: 'must_do',
        })

        expect(prioritized.updateData.priority).toBe('must_do')
        expect(prioritized.changes).toContain('priority to "must_do"')

        const cleared = await taskService.updateTask({
            taskId: 'task-1',
            projectId: 'project-1',
            currentTask: prioritized.updatedTask,
            priority: 'none',
        })
        expect(cleared.updateData.priority).toBe('none')
        expect(cleared.changes).toContain('priority cleared')
    })

    test('rejects unsupported priority values', async () => {
        await expect(
            taskService.updateTask({
                taskId: 'task-1',
                projectId: 'project-1',
                currentTask: { id: 'task-1', name: 'Launch', priority: 'none', userId: 'user-1' },
                priority: 'urgent',
            })
        ).rejects.toThrow('Invalid priority')
    })

    test('defaults newly created tasks to no priority', async () => {
        const createService = new TaskService({
            enableFeeds: false,
            enableValidation: false,
            idGenerator: () => 'task-1',
        })
        await createService.initialize()
        const result = await createService.createTask(
            {
                name: 'Launch',
                userId: 'user-1',
                projectId: 'project-1',
            },
            { userId: 'user-1', projectId: 'project-1' }
        )
        expect(result.task.priority).toBe('none')
    })

    test('normalizes invalid legacy priorities while rebuilding task data', async () => {
        const createService = new TaskService({
            enableFeeds: false,
            enableValidation: false,
            idGenerator: () => 'task-1',
        })
        await createService.initialize()
        const result = await createService.createTask(
            {
                name: 'Legacy task',
                userId: 'user-1',
                projectId: 'project-1',
                priority: 'urgent',
            },
            { userId: 'user-1', projectId: 'project-1' }
        )
        expect(result.task.priority).toBe('none')
    })
})
