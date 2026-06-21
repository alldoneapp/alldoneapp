const moment = require('moment-timezone')
const TaskUpdateService = require('./TaskUpdateService')

describe('TaskUpdateService recurrence updates', () => {
    test('forwards recurrence to the persisted task update', async () => {
        const updateAndPersistTask = jest.fn().mockResolvedValue({
            changes: ['recurrence to "monthly"'],
            updatedTask: {
                id: 'task-1',
                recurrence: 'monthly',
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
                name: 'Monthly review',
                recurrence: 'never',
                userId: 'user-1',
            },
            'project-1',
            'Project One',
            { recurrence: 'monthly' },
            'user-1',
            { uid: 'assistant-1' }
        )

        expect(updateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                taskId: 'task-1',
                recurrence: 'monthly',
            })
        )
        expect(result.task.recurrence).toBe('monthly')
    })
})
