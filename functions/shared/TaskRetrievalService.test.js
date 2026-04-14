const { TaskRetrievalService } = require('./TaskRetrievalService')

describe('TaskRetrievalService all-status date support', () => {
    test('sorts mixed open and done tasks by their relevant date', () => {
        const service = new TaskRetrievalService({ database: {} })

        expect(
            service
                .sortTasksForStatus(
                    [
                        { documentId: 'done-older', done: true, completed: 100, sortIndex: 2 },
                        { documentId: 'open-newer', done: false, dueDate: 300, sortIndex: 1 },
                        { documentId: 'done-newer', done: true, completed: 200, sortIndex: 3 },
                    ],
                    'all'
                )
                .map(task => task.documentId)
        ).toEqual(['open-newer', 'done-newer', 'done-older'])
    })

    test('merges open and done task results for status all with a date filter', () => {
        const service = new TaskRetrievalService({ database: {} })

        const openResult = {
            tasks: [
                { documentId: 'open-1', done: false, dueDate: 200, sortIndex: 5 },
                { documentId: 'open-2', done: false, dueDate: 50, sortIndex: 4 },
            ],
            subtasksByParent: { parentA: [{ documentId: 'sub-open' }] },
            includeSubtasks: true,
            parentId: null,
            query: { perProjectLimit: 1000, hasMore: false },
            focusTask: { documentId: 'open-1' },
            focusTaskInResults: true,
            timezoneOffset: 60,
        }
        const doneResult = {
            tasks: [{ documentId: 'done-1', done: true, completed: 150, sortIndex: 3 }],
            subtasksByParent: { parentB: [{ documentId: 'sub-done' }] },
            includeSubtasks: true,
            parentId: null,
            query: { perProjectLimit: 1000, hasMore: true },
            focusTask: null,
            focusTaskInResults: false,
            timezoneOffset: 60,
        }

        expect(service.mergeAllStatusTaskResults(openResult, doneResult, 'all', 'today', 2)).toMatchObject({
            success: true,
            count: 2,
            status: 'all',
            dateFilter: 'all tasks matching "today" (open tasks use due date, done tasks use completion date)',
            tasks: [
                { documentId: 'open-1', done: false, dueDate: 200, sortIndex: 5 },
                { documentId: 'done-1', done: true, completed: 150, sortIndex: 3 },
            ],
            subtasksByParent: {
                parentA: [{ documentId: 'sub-open' }],
                parentB: [{ documentId: 'sub-done' }],
            },
            query: {
                perProjectLimit: 1000,
                hasMore: true,
            },
            focusTask: { documentId: 'open-1' },
            focusTaskInResults: true,
            focusTaskIndex: 0,
            timezoneOffset: 60,
        })
    })
})

describe('TaskRetrievalService task comments support', () => {
    test('maps recent comments into minimal task results', async () => {
        const commentsSnapshot = {
            forEach: callback => {
                callback({
                    id: 'comment-2',
                    data: () => ({
                        commentText: 'Second update',
                        created: 200,
                        creatorId: 'user-2',
                        fromAssistant: true,
                        commentType: 'STAYWARD_COMMENT',
                    }),
                })
                callback({
                    id: 'comment-1',
                    data: () => ({
                        commentText: 'First update',
                        created: 100,
                        creatorId: 'user-1',
                        fromAssistant: false,
                        commentType: 'STAYWARD_COMMENT',
                    }),
                })
            },
        }

        const taskSnapshot = {
            forEach: callback => {
                callback({
                    id: 'task-1',
                    data: () => ({
                        name: 'Follow up',
                        done: false,
                        sortIndex: 10,
                        commentsData: {
                            amount: 2,
                            lastComment: 'Second update',
                        },
                    }),
                })
            },
        }

        const taskQuery = {
            get: jest.fn().mockResolvedValue(taskSnapshot),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        }

        const commentsQuery = {
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(commentsSnapshot),
        }

        const database = {
            collection: jest.fn(path => {
                if (path === 'items/project-1/tasks') return taskQuery
                if (path === 'chatComments/project-1/tasks/task-1/comments') return commentsQuery
                if (path === 'users') {
                    return {
                        doc: () => ({
                            get: jest.fn().mockResolvedValue({ exists: false }),
                        }),
                    }
                }
                throw new Error(`Unexpected collection path: ${path}`)
            }),
        }

        const service = new TaskRetrievalService({ database })
        await service.initialize()

        const result = await service.getTasks({
            projectId: 'project-1',
            userId: 'user-1',
            status: 'open',
            selectMinimalFields: true,
            date: 'today',
            perProjectLimit: 10,
            limit: 10,
        })

        expect(result.tasks).toEqual([
            {
                documentId: 'task-1',
                projectId: 'project-1',
                projectName: undefined,
                name: 'Follow up',
                done: false,
                completed: null,
                humanReadableId: null,
                dueDate: null,
                sortIndex: 10,
                parentGoal: null,
                calendarTime: null,
                comments: [
                    {
                        id: 'comment-1',
                        commentText: 'First update',
                        created: 100,
                        creatorId: 'user-1',
                        fromAssistant: false,
                        commentType: 'STAYWARD_COMMENT',
                        isLoading: false,
                    },
                    {
                        id: 'comment-2',
                        commentText: 'Second update',
                        created: 200,
                        creatorId: 'user-2',
                        fromAssistant: true,
                        commentType: 'STAYWARD_COMMENT',
                        isLoading: false,
                    },
                ],
                commentsData: {
                    amount: 2,
                    lastComment: 'Second update',
                },
                isFocus: false,
            },
        ])
    })
})
