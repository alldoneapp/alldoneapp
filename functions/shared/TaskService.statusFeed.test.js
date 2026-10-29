const { TaskService } = require('./TaskService')
const { buildTaskUpdateFeedEntryText } = require('./taskUpdateFeedText')

// AT-2906: completing a task through update_task already gets a feed from the onUpdateTask
// trigger ("checked task as Done"). A second "marked as complete" entry showed every
// completion twice in the activity lists, once of them untranslated.
describe('TaskService update feed for status changes', () => {
    const currentTask = { id: 'task-1', name: 'Interview üben', userId: 'user-1', done: false, priority: 'none' }
    const feedUser = { uid: 'user-1', displayName: 'Karsten' }

    const buildService = async () => {
        const service = new TaskService({ enableFeeds: true })
        await service.initialize()
        const createTaskFeed = jest
            .spyOn(service, 'createTaskFeed')
            .mockImplementation(async (_type, { entryText }) => ({ feed: { entryText } }))
        return { service, createTaskFeed }
    }

    test('a completion alone writes the task but leaves its feed to the trigger', async () => {
        const { service, createTaskFeed } = await buildService()

        const result = await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            completed: true,
            feedUser,
        })

        expect(result.changes).toEqual(['marked as complete'])
        expect(result.updateData).toEqual(expect.objectContaining({ done: true, inDone: true }))
        expect(createTaskFeed).not.toHaveBeenCalled()
        expect(result.feedData).toBeNull()
    })

    test('reopening alone does not write a duplicate feed either', async () => {
        const { service, createTaskFeed } = await buildService()

        await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask: { ...currentTask, done: true },
            completed: false,
            feedUser,
        })

        expect(createTaskFeed).not.toHaveBeenCalled()
    })

    test('other changes made together with a completion still get their own feed', async () => {
        const { service, createTaskFeed } = await buildService()

        await service.updateTask({
            taskId: 'task-1',
            projectId: 'p-1',
            currentTask,
            completed: true,
            priority: 'must_do',
            feedUser,
        })

        expect(createTaskFeed).toHaveBeenCalledWith(
            'updated',
            expect.objectContaining({ entryText: 'updated task priority' })
        )
    })

    test('entry text ignores status changes', () => {
        expect(buildTaskUpdateFeedEntryText(['marked as complete'])).toBeNull()
        expect(buildTaskUpdateFeedEntryText(['marked as incomplete'])).toBeNull()
        expect(buildTaskUpdateFeedEntryText([])).toBeNull()
        expect(buildTaskUpdateFeedEntryText(['name'])).toBe('updated task name')
        expect(buildTaskUpdateFeedEntryText(['marked as complete', 'name', 'priority to "high"'])).toBe(
            'updated task (name, priority)'
        )
    })
})
