const moment = require('moment-timezone')

jest.mock('./TaskCommentService', () => ({
    normalizeTaskComment: comment => {
        if (typeof comment !== 'string') throw new Error('Task comment must be a string')
        const normalized = comment.trim()
        if (!normalized) throw new Error('Task comment cannot be empty')
        if (normalized.length > 5000) throw new Error('Task comment cannot exceed 5000 characters')
        return normalized
    },
    TaskCommentService: jest.fn(),
}))

const mockGetBulkTasks = jest.fn()
jest.mock('./TaskRetrievalService', () => ({
    TaskRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(),
        getTasks: mockGetBulkTasks,
    })),
}))

const TaskUpdateService = require('./TaskUpdateService')

describe('TaskUpdateService comments', () => {
    const currentTask = {
        id: 'task-1',
        name: 'Launch',
        priority: 'none',
        userId: 'user-1',
    }

    const createService = () => {
        const database = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ timezone: 'UTC' }) }),
                })),
            })),
        }
        const service = new TaskUpdateService({ database, moment })
        service.initialized = true
        service.taskSearchService = {
            findTaskForUpdate: jest.fn().mockResolvedValue({
                decision: 'single_match',
                selectedMatch: { task: currentTask, projectId: 'project-1', projectName: 'Project One' },
            }),
        }
        service.taskService = {
            updateAndPersistTask: jest.fn().mockResolvedValue({
                changes: [],
                updatedTask: currentTask,
                feedData: null,
            }),
        }
        service.taskCommentService = {
            addComment: jest.fn().mockResolvedValue({
                success: true,
                commentId: 'comment-1',
                commentText: 'This blocks the launch.',
            }),
        }
        return service
    }

    test('supports a comment-only update without forwarding comment into TaskService', async () => {
        const service = createService()
        const result = await service.findAndUpdateTask(
            'user-1',
            { taskId: 'task-1' },
            { taskId: 'task-1', comment: '  This blocks the launch.  ' },
            { feedUser: { uid: 'assistant-1' }, commentFromAssistant: true }
        )

        expect(service.taskService.updateAndPersistTask).toHaveBeenCalledWith(
            expect.not.objectContaining({ comment: expect.anything() })
        )
        expect(service.taskCommentService.addComment).toHaveBeenCalledWith(
            expect.objectContaining({
                comment: 'This blocks the launch.',
                fromAssistant: true,
            })
        )
        expect(result.commentResult.commentId).toBe('comment-1')
        expect(result.message).toContain('Comment added')
    })

    test('forwards silentComment so update_task comments do not mark threads unread', async () => {
        const service = createService()
        await service.findAndUpdateTask(
            'user-1',
            { taskId: 'task-1' },
            { taskId: 'task-1', comment: 'Silent context' },
            { feedUser: { uid: 'assistant-1' }, commentFromAssistant: true, silentComment: true }
        )

        expect(service.taskCommentService.addComment).toHaveBeenCalledWith(
            expect.objectContaining({ comment: 'Silent context', fromAssistant: true, silent: true })
        )
    })

    test('supports a priority update with an explanatory comment found by task name', async () => {
        const service = createService()
        service.taskService.updateAndPersistTask.mockResolvedValue({
            changes: ['priority to "must_do"'],
            updatedTask: { ...currentTask, priority: 'must_do' },
            feedData: null,
        })

        const result = await service.findAndUpdateTask(
            'user-1',
            { taskName: 'Launch' },
            { priority: 'must_do', comment: 'Launch is blocked without this.' },
            { feedUser: { uid: 'assistant-1' }, commentFromAssistant: true }
        )

        expect(service.taskSearchService.findTaskForUpdate).toHaveBeenCalledWith(
            'user-1',
            { taskName: 'Launch' },
            expect.any(Object)
        )
        expect(service.taskService.updateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'must_do' })
        )
        expect(result.commentResult.success).toBe(true)
    })

    test('reports a partial failure when the update succeeds but its comment fails', async () => {
        const service = createService()
        service.taskService.updateAndPersistTask.mockResolvedValue({
            changes: ['priority to "should_do"'],
            updatedTask: { ...currentTask, priority: 'should_do' },
            feedData: null,
        })
        service.taskCommentService.addComment.mockRejectedValue(new Error('comment write failed'))

        const result = await service.findAndUpdateTask(
            'user-1',
            { taskId: 'task-1' },
            { priority: 'should_do', comment: 'Important but not blocking.' },
            { feedUser: { uid: 'assistant-1' }, commentFromAssistant: true }
        )

        expect(result.success).toBe(true)
        expect(result.partialFailure).toBe(true)
        expect(result.commentResult).toEqual({ success: false, error: 'comment write failed' })
    })

    test('requires a comment for non-empty priority assignments', async () => {
        const service = createService()
        await expect(
            service.findAndUpdateTask('user-1', { taskId: 'task-1' }, { priority: 'must_do' })
        ).rejects.toThrow('comment is required')
        await expect(
            service.findAndUpdateTask('user-1', { taskId: 'task-1' }, { priority: 'do_later' })
        ).rejects.toThrow('comment is required')
    })

    test('rejects blank and oversized comments', () => {
        const service = createService()
        expect(() => service.normalizeCommentFields({ comment: '   ' })).toThrow('cannot be empty')
        expect(() => service.normalizeCommentFields({ comment: 'x'.repeat(5001) })).toThrow('cannot exceed 5000')
    })

    test('allows clearing priority without a comment', () => {
        const service = createService()
        expect(service.normalizeCommentFields({ priority: 'none' })).toEqual({ priority: 'none' })
    })

    test('adds the same bulk comment only after each task update succeeds', async () => {
        const service = createService()
        const firstTask = { ...currentTask, id: 'task-1' }
        const secondTask = { ...currentTask, id: 'task-2', name: 'Ship' }
        mockGetBulkTasks.mockResolvedValueOnce({ tasks: [firstTask, secondTask] })
        service.performTaskUpdate = jest
            .fn()
            .mockResolvedValueOnce({ success: true, task: firstTask, changes: [] })
            .mockRejectedValueOnce(new Error('task update failed'))

        const result = await service.findAndUpdateTask(
            'user-1',
            { projectId: 'project-1' },
            { comment: 'Shared prioritization context' },
            {
                updateAll: true,
                feedUser: { uid: 'assistant-1' },
                commentFromAssistant: true,
            }
        )

        expect(service.taskCommentService.addComment).toHaveBeenCalledTimes(1)
        expect(service.taskCommentService.addComment).toHaveBeenCalledWith(
            expect.objectContaining({
                task: firstTask,
                comment: 'Shared prioritization context',
            })
        )
        expect(result.updated[0].commentResult.success).toBe(true)
        expect(result.failed).toEqual([expect.objectContaining({ id: 'task-2', error: 'task update failed' })])
    })
})
