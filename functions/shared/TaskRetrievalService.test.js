const moment = require('moment-timezone')
const { TaskRetrievalService } = require('./TaskRetrievalService')
const { NoteRetrievalService } = require('./NoteRetrievalService')
const { UpdateRetrievalService } = require('./UpdateRetrievalService')

describe('rolling 24-hour date filters', () => {
    test('uses the same rolling window for tasks, notes, and updates', () => {
        const clock = (...args) => (args.length ? moment(...args) : moment('2026-09-26T04:35:00Z'))
        const expected = {
            start: Date.parse('2026-09-25T04:35:00Z'),
            end: Date.parse('2026-09-26T04:35:00Z'),
        }

        const tasks = new TaskRetrievalService({ moment: clock })
        const notes = new NoteRetrievalService({ moment: clock })
        const updates = new UpdateRetrievalService({ moment: clock })

        expect(tasks.buildDateFilters('last 24 hours', 'done', 120)).toEqual({
            field: 'completed',
            operator: 'range',
            value: expected,
        })
        expect(tasks.buildDateFilters('past 24 hours', 'open', 120)).toEqual({
            field: 'dueDate',
            operator: 'range',
            value: expected,
        })
        expect(notes.buildDateRange('last 24 hours', 120)).toEqual(expected)
        expect(updates.buildDateRange('last 24 hours', 120)).toEqual(expected)
    })
})

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
    test('adds an isPublicFor visibility filter to task queries', () => {
        const query = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        }
        const database = {
            collection: jest.fn(() => query),
        }
        const service = new TaskRetrievalService({ database })

        service.buildTaskQuery({
            projectId: 'project-1',
            userId: 'user-1',
            status: 'open',
            userPermissions: [0, 'user-1'],
        })

        expect(query.where).toHaveBeenCalledWith('isPublicFor', 'array-contains-any', [0, 'user-1'])
    })

    test('defaults authenticated task queries to public and user-visible tasks', () => {
        const query = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        }
        const database = {
            collection: jest.fn(() => query),
        }
        const service = new TaskRetrievalService({ database })

        service.buildTaskQuery({
            projectId: 'project-1',
            userId: 'user-1',
            status: 'open',
        })

        expect(query.where).toHaveBeenCalledWith('isPublicFor', 'array-contains-any', [0, 'user-1'])
    })

    test('filters personal task scope by task owner', () => {
        const query = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        }
        const database = {
            collection: jest.fn(() => query),
        }
        const service = new TaskRetrievalService({ database })

        service.buildTaskQuery({
            projectId: 'project-1',
            userId: 'user-1',
            status: 'done',
            userPermissions: [0, 'user-1'],
            taskScope: 'mine',
        })

        expect(query.where).toHaveBeenCalledWith('isPublicFor', 'array-contains-any', [0, 'user-1'])
        expect(query.where).toHaveBeenCalledWith('userId', '==', 'user-1')
    })

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
                        userId: 'user-1',
                        currentReviewerId: 'user-1',
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
                ownerUserId: 'user-1',
                currentReviewerId: 'user-1',
                isOwnedByRequestingUser: true,
                isCurrentReviewer: true,
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

describe('task totals use the same filters as the returned list', () => {
    const date = Date.parse('2026-10-08T12:00:00+02:00')
    const makeTasks = (count, fields = {}) =>
        Array.from({ length: count }, (_, index) => ({
            id: `${fields.userId || 'user-1'}-${index}`,
            name: `Task ${index}`,
            isPublicFor: [0],
            userId: 'user-1',
            currentReviewerId: 'user-1',
            isSubtask: false,
            inDone: false,
            done: false,
            dueDate: date,
            sortIndex: count - index,
            ...fields,
        }))

    function database(failCount = false) {
        const rows = {
            'items/p1/tasks': [...makeTasks(50), ...makeTasks(12, { userId: 'other-user' })],
            'items/p2/tasks': [
                ...makeTasks(32),
                ...makeTasks(5, { currentReviewerId: 'other-reviewer' }),
                ...makeTasks(3, { dueDate: date + 86400000 }),
                ...makeTasks(4, { isPublicFor: ['private-user'] }),
            ],
        }
        const makeQuery = (records, filters = [], limit = Infinity) => {
            const matches = () =>
                records.filter(record =>
                    filters.every(([key, operator, value]) => {
                        if (operator === '==') return record[key] === value
                        if (operator === '>=') return record[key] >= value
                        if (operator === '<=') return record[key] <= value
                        if (operator === 'array-contains-any') return record[key].some(item => value.includes(item))
                        throw new Error(`Unsupported query operator: ${operator}`)
                    })
                )
            return {
                where: (key, operator, value) => makeQuery(records, [...filters, [key, operator, value]], limit),
                orderBy: () => makeQuery(records, filters, limit),
                limit: value => makeQuery(records, filters, value),
                get: async () => ({
                    forEach: callback =>
                        matches()
                            .slice(0, limit)
                            .forEach(record => callback({ id: record.id, data: () => record })),
                }),
                count: () => ({
                    get: async () => {
                        if (failCount) throw new Error('Count unavailable')
                        return { data: () => ({ count: matches().length }) }
                    },
                }),
            }
        }
        return {
            collection: path =>
                path === 'users'
                    ? { doc: () => ({ get: async () => ({ exists: false }) }) }
                    : makeQuery(rows[path] || []),
        }
    }

    const params = {
        userId: 'user-1',
        status: 'open',
        date: '2026-10-08',
        taskScope: 'mine',
        timezoneOffset: 120,
        limit: 20,
        perProjectLimit: 20,
    }

    test('single-project count excludes other owners and preserves the matching total beyond the limit', async () => {
        const service = new TaskRetrievalService({ database: database() })
        const result = await service.getTasks({ ...params, projectId: 'p1' })
        expect(result).toMatchObject({
            count: 20,
            totalAvailable: 50,
            totalCountIsExact: true,
            query: { hasMore: true },
        })
        expect(result.tasks.every(task => task.userId === 'user-1')).toBe(true)
    })

    test('cross-project totals honor ownership, reviewer, date and visibility filters', async () => {
        const service = new TaskRetrievalService({ database: database() })
        const result = await service.getTasksFromMultipleProjects(params, ['p1', 'p2'])
        expect(result).toMatchObject({
            count: 40,
            totalAcrossProjects: 82,
            totalAvailable: 82,
            totalCountIsExact: true,
            query: { hasMore: true },
        })
        const shared = await service.getTasksFromMultipleProjects(
            { ...params, taskScope: 'visible', restrictToCurrentReviewer: false },
            ['p1', 'p2']
        )
        expect(shared.totalAcrossProjects).toBe(99)
    })

    test('a failed count is a lower bound, not an exact total', async () => {
        const service = new TaskRetrievalService({ database: database(true) })
        const result = await service.getTasksFromMultipleProjects(params, ['p1', 'p2'])
        expect(result).toMatchObject({ count: 40, totalAcrossProjects: 40, totalCountIsExact: false })
    })

    test('mixed open/done listings preserve both uncapped totals and uncertainty', () => {
        const service = new TaskRetrievalService()
        const open = { tasks: [{ id: 'open' }], totalAvailable: 82, totalCountIsExact: true }
        const done = { tasks: [{ id: 'done', done: true }], totalAvailable: 9, totalCountIsExact: true }
        expect(service.mergeAllStatusTaskResults(open, done, 'all', '2026-10-08', 1)).toMatchObject({
            count: 1,
            totalAvailable: 91,
            totalCountIsExact: true,
        })
        expect(
            service.mergeAllStatusTaskResults(open, { ...done, totalCountIsExact: false }, 'all', '2026-10-08', 1)
                .totalCountIsExact
        ).toBe(false)
    })
})
