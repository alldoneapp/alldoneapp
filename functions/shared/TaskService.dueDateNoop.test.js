const { TaskService } = require('./TaskService')

// AT-2891: re-sending the stored dueDate must not write the task or post "updated task due".
describe('TaskService unchanged dueDate', () => {
    const DUE = 1793055600000
    const currentTask = { id: 'task-1', name: 'Judy Job', userId: 'user-1', dueDate: DUE, priority: 'none' }

    const buildService = async options => {
        const service = new TaskService({ enableFeeds: false, ...options })
        await service.initialize()
        return service
    }

    test('the same timestamp is not a change', async () => {
        const service = await buildService()

        const result = await service.updateTask({ taskId: 'task-1', projectId: 'p-1', currentTask, dueDate: DUE })

        expect(result.changes).toEqual([])
        expect(result.updateData).toEqual({})
    })

    test('a different timestamp, even on the same day, is still a change', async () => {
        const service = await buildService()

        const result = await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            dueDate: DUE + 15 * 60 * 60 * 1000,
        })

        expect(result.changes).toEqual(['due date'])
        expect(result.updateData.dueDate).toBe(DUE + 15 * 60 * 60 * 1000)
        expect(result.updateData.lastEditionDate).toEqual(expect.any(Number))
    })

    test('no feed is generated and nothing is persisted for an unchanged dueDate', async () => {
        const database = { doc: jest.fn(), collection: jest.fn() }
        const service = await buildService({ enableFeeds: true, database })
        const createTaskFeed = jest.spyOn(service, 'createTaskFeed')

        const result = await service.updateAndPersistTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            dueDate: DUE,
            feedUser: { uid: 'user-1', displayName: 'Karsten', via: 'mcp', viaClient: 'Codex' },
        })

        expect(result.persisted).toBe(false)
        expect(createTaskFeed).not.toHaveBeenCalled()
        expect(database.doc).not.toHaveBeenCalled()
        expect(database.collection).not.toHaveBeenCalled()
    })

    test('focus keeps the due date the caller asked to keep', async () => {
        const service = await buildService()

        const unchanged = await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            dueDate: DUE,
            focus: true,
            focusUserId: 'user-1',
        })
        expect(unchanged.focusAction).toEqual(expect.objectContaining({ type: 'set', preserveDueDate: true }))

        const keptDay = await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            keepCurrentDueDate: true,
            focus: true,
            focusUserId: 'user-1',
        })
        expect(keptDay.focusAction).toEqual(expect.objectContaining({ type: 'set', preserveDueDate: true }))
        expect(keptDay.updateData).not.toHaveProperty('keepCurrentDueDate')

        const plainFocus = await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            focus: true,
            focusUserId: 'user-1',
        })
        expect(plainFocus.focusAction.preserveDueDate).toBe(false)
    })
})
