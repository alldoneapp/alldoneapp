const { executeGoalPostpone } = require('./goalPostponeService')

const snapshot = (exists, data) => ({ exists, data: () => data })

function buildDb({ goal, tasks = [], existingAction = null, user = { projectIds: ['project-1'] } }) {
    const writes = []
    const refs = new Map()
    const ref = path => {
        if (!refs.has(path)) refs.set(path, { path })
        return refs.get(path)
    }
    const taskQuery = { type: 'task-query' }
    const taskDocs = tasks.map(task => ({
        id: task.id,
        ref: ref(`items/project-1/tasks/${task.id}`),
        data: () => task,
    }))
    const transaction = {
        get: jest.fn(reference => {
            if (reference === taskQuery) return Promise.resolve({ docs: taskDocs })
            if (reference.path === 'users/user-1/undoActions/request-1') {
                return Promise.resolve(snapshot(!!existingAction, existingAction))
            }
            if (reference.path === 'goals/project-1/items/goal-1') {
                return Promise.resolve(snapshot(!!goal, goal))
            }
            return Promise.resolve(snapshot(false))
        }),
        update: jest.fn((reference, data) => writes.push({ type: 'update', path: reference.path, data })),
        set: jest.fn((reference, data) => writes.push({ type: 'set', path: reference.path, data })),
    }
    const db = {
        doc: jest.fn(ref),
        collection: jest.fn(() => ({
            where: jest.fn(() => ({
                where: jest.fn(() => taskQuery),
            })),
        })),
        runTransaction: jest.fn(handler => handler(transaction)),
    }
    refs.set('users/user-1', {
        path: 'users/user-1',
        get: jest.fn(() => Promise.resolve(snapshot(true, user))),
    })
    return { db, writes, transaction }
}

const request = {
    projectId: 'project-1',
    goalId: 'goal-1',
    targetUserId: 'user-1',
    requestId: 'request-1',
    date: 5000,
    endOfToday: 3000,
    cascadeToTasks: true,
}

const goal = {
    name: 'Ship the launch',
    assigneesIds: ['user-1'],
    assigneesReminderDate: { 'user-1': 1000, 'user-2': 1500 },
    timesPostponed: 2,
    isPublicFor: [0],
}

describe('GoalPostponeService', () => {
    test('postpones the goal and eligible connected tasks with one exact undo action', async () => {
        const { db, writes } = buildDb({
            goal,
            tasks: [
                {
                    id: 'task-overdue',
                    parentGoalId: 'goal-1',
                    dueDate: 1000,
                    sortIndex: 10,
                    timesPostponed: 4,
                    isPublicFor: [0],
                },
                {
                    id: 'task-future',
                    parentGoalId: 'goal-1',
                    dueDate: 4000,
                    sortIndex: 20,
                    timesPostponed: 1,
                    isPublicFor: [0],
                },
                {
                    id: 'task-without-date',
                    parentGoalId: 'goal-1',
                    sortIndex: 30,
                    timesPostponed: 0,
                    isPublicFor: [0],
                },
            ],
        })
        const sortIndexes = [101]

        const result = await executeGoalPostpone({
            actorUserId: 'user-1',
            data: request,
            db,
            createSortIndex: () => sortIndexes.shift(),
            now: 1234,
        })

        expect(result).toMatchObject({ updatedTaskCount: 1, actionId: 'request-1', duplicate: false })
        expect(writes.filter(write => write.type === 'set')).toHaveLength(1)
        expect(writes).toContainEqual({
            type: 'update',
            path: 'goals/project-1/items/goal-1',
            data: { 'assigneesReminderDate.user-1': 5000, timesPostponed: 3 },
        })
        expect(writes).toContainEqual({
            type: 'update',
            path: 'items/project-1/tasks/task-overdue',
            data: { dueDate: 5000, sortIndex: 101, timesPostponed: 5 },
        })
        expect(writes.some(write => write.path.endsWith('task-future'))).toBe(false)
        expect(writes.some(write => write.path.endsWith('task-without-date'))).toBe(false)

        const action = writes.find(write => write.type === 'set').data
        expect(action.operations).toEqual([
            expect.objectContaining({
                objectType: 'goal',
                objectId: 'goal-1',
                before: { 'assigneesReminderDate.user-1': 1000, timesPostponed: 2 },
                after: { 'assigneesReminderDate.user-1': 5000, timesPostponed: 3 },
            }),
            expect.objectContaining({
                objectType: 'task',
                objectId: 'task-overdue',
                before: { dueDate: 1000, sortIndex: 10, timesPostponed: 4 },
                after: { dueDate: 5000, sortIndex: 101, timesPostponed: 5 },
                skipIfMissing: true,
                requiredCurrentFields: { parentGoalId: 'goal-1' },
            }),
        ])
    })

    test('records a goal-only undo action when no connected task needs changing', async () => {
        const { db, writes } = buildDb({ goal, tasks: [] })

        const result = await executeGoalPostpone({ actorUserId: 'user-1', data: request, db, now: 1234 })

        expect(result.updatedTaskCount).toBe(0)
        const action = writes.find(write => write.type === 'set').data
        expect(action.operations).toHaveLength(1)
        expect(writes.filter(write => write.type === 'update')).toHaveLength(1)
    })

    test('does not apply or register the same request twice', async () => {
        const { db, writes } = buildDb({
            goal,
            existingAction: { operations: [{ objectType: 'goal' }, { objectType: 'task' }] },
        })

        const result = await executeGoalPostpone({ actorUserId: 'user-1', data: request, db })

        expect(result).toMatchObject({ duplicate: true, updatedTaskCount: 1 })
        expect(writes).toEqual([])
    })

    test('captures absent counters so undo can remove them instead of writing zero', async () => {
        const goalWithoutCounter = { ...goal }
        delete goalWithoutCounter.timesPostponed
        const taskWithoutCounter = {
            id: 'task-overdue',
            parentGoalId: 'goal-1',
            dueDate: 1000,
            sortIndex: 10,
            isPublicFor: [0],
        }
        const { db, writes } = buildDb({ goal: goalWithoutCounter, tasks: [taskWithoutCounter] })

        await executeGoalPostpone({ actorUserId: 'user-1', data: request, db, createSortIndex: () => 101 })

        const action = writes.find(write => write.type === 'set').data
        expect(action.operations[0].beforeMissingFields).toEqual(['timesPostponed'])
        expect(action.operations[1].beforeMissingFields).toEqual(['timesPostponed'])
    })
})
