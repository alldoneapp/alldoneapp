jest.mock('firebase-admin', () => ({
    firestore: {
        Timestamp: { now: jest.fn(() => 'timestamp-now') },
        FieldValue: { increment: jest.fn(value => ({ increment: value })) },
    },
}))

jest.mock('../Firestore/generalFirestoreCloud', () => ({
    getId: jest.fn(() => 'comment-1'),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    getBaseUrl: jest.fn(() => 'https://my.alldone.app'),
}))

const { TaskCommentService, normalizeTaskComment } = require('./TaskCommentService')

describe('TaskCommentService', () => {
    test('validates and trims task comments', () => {
        expect(normalizeTaskComment('  Useful context  ')).toBe('Useful context')
        expect(() => normalizeTaskComment(' ')).toThrow('cannot be empty')
        expect(() => normalizeTaskComment('x'.repeat(5001))).toThrow('cannot exceed 5000')
    })

    test('writes the task comment, synchronized metadata, and follower notifications', async () => {
        const refs = new Map()
        const taskData = {
            id: 'task-1',
            name: 'Launch',
            extendedName: 'Launch',
            userId: 'user-1',
            creatorId: 'user-1',
            created: 1,
            isPublicFor: [0, 'user-1'],
            commentsData: { amount: 2, retained: true },
        }
        const getSnapshot = path => {
            if (path === 'items/project-1/tasks/task-1') {
                return { exists: true, data: () => taskData }
            }
            if (path === 'projects/project-1') {
                return { exists: true, data: () => ({ name: 'Product' }) }
            }
            if (path === 'followers/project-1/tasks/task-1') {
                return { exists: true, data: () => ({ usersFollowing: ['user-2'] }) }
            }
            return { exists: false, data: () => ({}) }
        }
        const doc = jest.fn(path => {
            if (!refs.has(path)) refs.set(path, { path, get: jest.fn(() => Promise.resolve(getSnapshot(path))) })
            return refs.get(path)
        })
        const transaction = {
            get: jest.fn(ref => ref.get()),
            set: jest.fn(),
            update: jest.fn(),
        }
        const batch = { set: jest.fn(), commit: jest.fn(() => Promise.resolve()) }
        const database = {
            doc,
            runTransaction: jest.fn(callback => callback(transaction)),
            batch: jest.fn(() => batch),
        }
        const service = new TaskCommentService({ database })

        const result = await service.addComment({
            projectId: 'project-1',
            taskId: 'task-1',
            task: taskData,
            comment: '  This blocks the launch.  ',
            actor: { uid: 'assistant-1', displayName: 'Anna' },
            fromAssistant: true,
        })

        expect(result).toEqual(
            expect.objectContaining({
                success: true,
                commentId: 'comment-1',
                commentText: 'This blocks the launch.',
                fromAssistant: true,
                notifiedFollowers: 2,
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'chatComments/project-1/tasks/task-1/comments/comment-1',
            }),
            expect.objectContaining({
                creatorId: 'assistant-1',
                fromAssistant: true,
                commentText: 'This blocks the launch.',
            })
        )
        expect(transaction.update).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'items/project-1/tasks/task-1' }),
            {
                commentsData: expect.objectContaining({
                    lastCommentOwnerId: 'assistant-1',
                    amount: 3,
                    retained: true,
                }),
            }
        )
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'followers/project-1/tasks/task-1' }),
            { usersFollowing: ['user-2', 'user-1', 'assistant-1'] },
            { merge: true }
        )
        expect(batch.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'chatNotifications/project-1/user-1/comment-1' }),
            expect.objectContaining({ creatorId: 'assistant-1', creatorType: 'assistant' })
        )
        expect(batch.commit).toHaveBeenCalled()
    })

    test('attributes assistant-less comments to the authenticated user', async () => {
        const refs = new Map()
        const taskData = {
            name: 'Launch',
            userId: 'user-1',
            creatorId: 'user-1',
            isPublicFor: [0, 'user-1'],
        }
        const doc = jest.fn(path => {
            if (!refs.has(path)) {
                refs.set(path, {
                    path,
                    get: jest
                        .fn()
                        .mockResolvedValue(
                            path === 'items/project-1/tasks/task-1'
                                ? { exists: true, data: () => taskData }
                                : path === 'projects/project-1'
                                ? { exists: true, data: () => ({ name: 'Product' }) }
                                : { exists: false, data: () => ({}) }
                        ),
                })
            }
            return refs.get(path)
        })
        const transaction = {
            get: jest.fn(ref => ref.get()),
            set: jest.fn(),
            update: jest.fn(),
        }
        const batch = { set: jest.fn(), commit: jest.fn().mockResolvedValue() }
        const service = new TaskCommentService({
            database: {
                doc,
                runTransaction: jest.fn(callback => callback(transaction)),
                batch: jest.fn(() => batch),
            },
        })

        const result = await service.addComment({
            projectId: 'project-1',
            taskId: 'task-1',
            comment: 'User-authored MCP comment',
            actor: { uid: 'user-1', displayName: 'Karsten' },
        })

        expect(result.fromAssistant).toBe(false)
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'chatComments/project-1/tasks/task-1/comments/comment-1' }),
            expect.objectContaining({ creatorId: 'user-1', fromAssistant: false })
        )
    })
})
