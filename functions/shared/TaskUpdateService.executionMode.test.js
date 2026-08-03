const moment = require('moment-timezone')
const TaskUpdateService = require('./TaskUpdateService')

describe('TaskUpdateService execution mode updates', () => {
    test('forwards a user task mode to the persisted task update', async () => {
        const updateAndPersistTask = jest.fn().mockResolvedValue({
            changes: ['execution mode to "direct"'],
            updatedTask: {
                id: 'task-1',
                executionMode: 'direct',
            },
        })
        const database = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ timezone: 'UTC+02:00' }),
                    }),
                })),
            })),
        }
        const service = new TaskUpdateService({ database, moment })
        service.taskService = { updateAndPersistTask }

        const result = await service.performTaskUpdate(
            {
                id: 'task-1',
                name: 'User task',
                executionMode: 'workflow',
                userId: 'user-1',
            },
            'project-1',
            'Project One',
            { executionMode: 'direct' },
            'user-1',
            { uid: 'assistant-1' }
        )

        expect(updateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                taskId: 'task-1',
                executionMode: 'direct',
            })
        )
        expect(result.task.executionMode).toBe('direct')
    })
})
