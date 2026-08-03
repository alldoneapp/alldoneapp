const { TaskService } = require('./TaskService')

describe('TaskService execution mode', () => {
    let taskService

    beforeEach(async () => {
        taskService = new TaskService({
            enableFeeds: false,
            enableValidation: false,
            idGenerator: () => 'task-1',
        })
        await taskService.initialize()
    })

    test('defaults user tasks to workflow and accepts direct creation', async () => {
        const workflowTask = await taskService.createTask({
            name: 'Workflow task',
            userId: 'user-1',
            projectId: 'project-1',
        })
        const directTask = await taskService.createTask({
            name: 'Direct task',
            userId: 'user-1',
            projectId: 'project-1',
            executionMode: 'direct',
        })

        expect(workflowTask.task.executionMode).toBe('workflow')
        expect(directTask.task.executionMode).toBe('direct')
    })

    test('updates execution mode and rejects unsupported values', async () => {
        const currentTask = {
            id: 'task-1',
            name: 'User task',
            userId: 'user-1',
            executionMode: 'workflow',
        }
        const directTask = await taskService.updateTask({
            taskId: 'task-1',
            projectId: 'project-1',
            currentTask,
            executionMode: 'direct',
        })

        expect(directTask.updateData.executionMode).toBe('direct')
        expect(directTask.changes).toContain('execution mode to "direct"')

        await expect(
            taskService.updateTask({
                taskId: 'task-1',
                projectId: 'project-1',
                currentTask,
                executionMode: 'automatic',
            })
        ).rejects.toThrow('Invalid task execution mode')
    })
})
