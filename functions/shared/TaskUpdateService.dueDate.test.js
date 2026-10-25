const moment = require('moment-timezone')
const TaskUpdateService = require('./TaskUpdateService')

// The update funnel is fed by model-authored JSON (assistant tool calls and the
// MCP server), which can put anything under dueDate. Production carried tasks
// whose dueDate held an entire task object (client-side callback mismatch, since
// fixed) — the server must refuse such values instead of persisting them.
describe('TaskUpdateService dueDate validation', () => {
    const buildService = () => {
        const updateAndPersistTask = jest.fn().mockResolvedValue({
            changes: ['due date'],
            updatedTask: { id: 'task-1' },
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
        return { service, updateAndPersistTask }
    }

    const currentTask = {
        id: 'task-1',
        name: 'Review contract',
        userId: 'user-1',
        dueDate: 1755000000000,
    }

    const performUpdate = (service, updateFields) =>
        service.performTaskUpdate(currentTask, 'project-1', 'Project One', updateFields, 'user-1', {
            uid: 'assistant-1',
        })

    test('rejects a dueDate holding an object without persisting anything', async () => {
        const { service, updateAndPersistTask } = buildService()

        await expect(
            performUpdate(service, { dueDate: { id: 'task-2', name: 'a whole task object' } })
        ).rejects.toThrow('Invalid dueDate: received an object')
        expect(updateAndPersistTask).not.toHaveBeenCalled()
    })

    test('rejects an unparseable dueDate string, naming the value for the retry', async () => {
        const { service, updateAndPersistTask } = buildService()

        await expect(performUpdate(service, { dueDate: 'not-a-real-date' })).rejects.toThrow(
            'could not interpret "not-a-real-date" as a date'
        )
        expect(updateAndPersistTask).not.toHaveBeenCalled()
    })

    test('rejects a null dueDate instead of writing null to Firestore', async () => {
        const { service, updateAndPersistTask } = buildService()

        await expect(performUpdate(service, { dueDate: null })).rejects.toThrow('Invalid dueDate: received null')
        expect(updateAndPersistTask).not.toHaveBeenCalled()
    })

    test('forwards a valid millisecond timestamp unchanged', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, { dueDate: 1760000000000 })

        expect(updateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({ taskId: 'task-1', dueDate: 1760000000000 })
        )
    })

    test('keeps Number.MAX_SAFE_INTEGER ("Someday") valid', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, { dueDate: Number.MAX_SAFE_INTEGER })

        expect(updateAndPersistTask).toHaveBeenCalledWith(expect.objectContaining({ dueDate: Number.MAX_SAFE_INTEGER }))
    })

    test('still converts ISO strings and forwards the converted timestamp', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, { dueDate: '2026-01-15T18:00:00+02:00' })

        expect(updateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({ dueDate: moment.parseZone('2026-01-15T18:00:00+02:00').valueOf() })
        )
    })

    test('leaves an omitted dueDate untouched', async () => {
        const { service, updateAndPersistTask } = buildService()

        await performUpdate(service, { name: 'Renamed task' })

        expect(updateAndPersistTask).toHaveBeenCalledWith(expect.objectContaining({ dueDate: undefined }))
    })
})
