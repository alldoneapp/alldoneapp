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
