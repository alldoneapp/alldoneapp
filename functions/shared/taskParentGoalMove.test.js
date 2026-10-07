'use strict'

jest.mock('firebase-admin', () => ({}))
const { persistTaskParentGoalMove } = require('./taskParentGoalMove')
const { TaskService } = require('./TaskService')
const TaskUpdateService = require('./TaskUpdateService')
const moment = require('moment-timezone')

const sourcePath = 'items/source/tasks/task-1'
const targetPath = 'items/target/tasks/task-1'
const goalPath = 'goals/target/items/goal-1'
const parentPath = 'items/source/tasks/parent-1'
const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function createDatabase(initial) {
    const docs = clone(initial)
    let failCommit = 0
    let commits = 0
    const snapshot = path => ({ exists: docs[path] !== undefined, data: () => clone(docs[path]) })
    const doc = path => ({ path, get: jest.fn(async () => snapshot(path)) })
    const writes = jest.fn()
    const database = {
        doc,
        collection: path => ({ doc: id => doc(`${path}/${id}`) }),
        runTransaction: jest.fn(async callback => {
            const pending = []
            const transaction = {
                get: async ref => {
                    if (pending.length) throw new Error('Firestore transaction read after write')
                    return snapshot(ref.path)
                },
                set: (ref, value) => pending.push(['set', ref.path, clone(value)]),
                update: (ref, value) => pending.push(['update', ref.path, clone(value)]),
                delete: ref => pending.push(['delete', ref.path]),
            }
            const result = await callback(transaction)
            commits++
            if (commits === failCommit) throw new Error('transaction commit unavailable')
            for (const [type, path, value] of pending) {
                writes(type, path, value)
                if (type === 'delete') delete docs[path]
                else docs[path] = type === 'update' ? { ...docs[path], ...value } : value
            }
            return result
        }),
    }
    return { database, docs, writes, failOnCommit: number => (failCommit = number) }
}

describe('automatic parent goal project moves', () => {
    let database, docs, writes, failOnCommit, dependencies, params
    beforeEach(() => {
        ;({ database, docs, writes, failOnCommit } = createDatabase({
            'users/user-1': { projectIds: ['source', 'target'], timezone: 0 },
            'projects/source': { name: 'Source', userIds: ['user-1'] },
            'projects/target': { name: 'Target', userIds: ['user-1'] },
            [goalPath]: { isPublicFor: ['user-1'], lockKey: 'goal-lock' },
            [parentPath]: { isPublicFor: [0], subtaskIds: ['task-1', 'sibling'], subtaskNames: ['Task', 'Sibling'] },
            [sourcePath]: {
                id: 'task-1',
                name: 'Task',
                userId: 'old-owner',
                creatorId: 'old-owner',
                isPublicFor: [0],
                parentId: 'parent-1',
                isSubtask: true,
                parentDone: true,
                inDone: true,
                done: false,
                subtaskIds: ['child-1'],
                subtaskNames: ['Child'],
                parentGoalId: 'old-goal',
                observersIds: ['observer'],
                stepHistory: [-1, 'review'],
                goalSuggestion: { status: 'pending' },
                calendarData: { originalProjectId: 'calendar-project', start: '2030-01-01' },
            },
            'items/source/tasks/child-1': {
                id: 'child-1',
                name: 'Child',
                parentId: 'task-1',
                isSubtask: true,
                isPublicFor: [0],
                userId: 'old-owner',
            },
        }))
        dependencies = {
            copyChat: jest.fn().mockResolvedValue(undefined),
            copyFeeds: jest.fn().mockResolvedValue(undefined),
            persistFeeds: jest.fn().mockResolvedValue(undefined),
        }
        params = {
            projectId: 'source',
            parentGoalProjectId: 'target',
            parentGoalId: 'goal-1',
            taskId: 'task-1',
            userId: 'user-1',
            updateData: { name: 'Renamed', extendedName: 'Renamed' },
        }
    })
    const move = () => persistTaskParentGoalMove(database, params, dependencies)

    test('moves the entire tree, assigns the goal, detaches, resets workflow and pins the calendar', async () => {
        const result = await move()
        expect(docs[sourcePath]).toBeUndefined()
        expect(docs['items/source/tasks/child-1']).toBeUndefined()
        expect(docs[targetPath]).toMatchObject({
            parentId: null,
            isSubtask: false,
            parentDone: false,
            done: false,
            inDone: false,
            completed: null,
            projectId: 'target',
            name: 'Renamed',
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: ['user-1'],
            lockKey: 'goal-lock',
            userId: 'user-1',
            userIds: ['user-1'],
            observersIds: [],
            currentReviewerId: 'user-1',
            stepHistory: [-1],
            goalSuggestion: { status: 'superseded' },
            projectMove: { status: 'completed' },
            calendarData: { pinnedToProjectId: 'target', start: '2030-01-01' },
        })
        expect(docs['items/target/tasks/child-1']).toMatchObject({
            parentId: 'task-1',
            isSubtask: true,
            parentGoalId: 'goal-1',
            lockKey: 'goal-lock',
            projectMove: { status: 'completed' },
        })
        expect(docs[parentPath]).toMatchObject({ subtaskIds: ['sibling'], subtaskNames: ['Sibling'] })
        expect(result.updatedTask).toEqual(docs[targetPath])
        expect(dependencies.copyChat).toHaveBeenCalledTimes(2)
        expect(dependencies.copyFeeds).toHaveBeenCalledTimes(2)
    })

    test.each([
        'source-member',
        'target-member',
        'private-goal',
        'missing-goal',
        'private-child',
        'private-parent',
        'collision',
        'child-collision',
        'another-move',
        'wrong-parent',
        'cycle',
    ])('refuses %s before any durable writes', async failure => {
        if (failure === 'source-member') docs['projects/source'].userIds = []
        if (failure === 'target-member') docs['projects/target'].userIds = []
        if (failure === 'private-goal') docs[goalPath].isPublicFor = ['other-user']
        if (failure === 'missing-goal') delete docs[goalPath]
        if (failure === 'private-child') docs['items/source/tasks/child-1'].isPublicFor = ['other-user']
        if (failure === 'private-parent') docs[parentPath].isPublicFor = ['other-user']
        if (failure === 'collision') docs[targetPath] = { name: 'Unrelated task' }
        if (failure === 'child-collision') docs['items/target/tasks/child-1'] = { name: 'Unrelated child' }
        if (failure === 'another-move') docs[sourcePath].movingToOtherProjectId = 'other'
        if (failure === 'wrong-parent') docs['items/source/tasks/child-1'].parentId = 'other'
        if (failure === 'cycle') docs['items/source/tasks/child-1'].subtaskIds = ['task-1']
        await expect(move()).rejects.toThrow()
        expect(writes).not.toHaveBeenCalled()
        expect(dependencies.copyChat).not.toHaveBeenCalled()
    })

    test('a failed staging transaction creates no destination or marker', async () => {
        failOnCommit(1)
        await expect(move()).rejects.toThrow('commit unavailable')
        expect(docs[targetPath]).toBeUndefined()
        expect(docs[sourcePath].movingToOtherProjectId).toBeUndefined()
        expect(dependencies.copyChat).not.toHaveBeenCalled()
    })

    test.each(['copyChat', 'copyFeeds', 'persistFeeds', 'final-commit'])(
        'retains the source and reports %s failure, then resumes the same request',
        async failure => {
            if (failure === 'final-commit') failOnCommit(2)
            else dependencies[failure].mockRejectedValueOnce(new Error('history transfer unavailable'))
            await expect(move()).rejects.toThrow('partially completed')
            expect(docs[sourcePath]).toBeDefined()
            expect(docs[parentPath].subtaskIds).toContain('task-1')
            expect(docs[targetPath].projectMove.status).toBe('moving')
            const requestId = docs[targetPath].projectMove.requestId
            const result = await move()
            expect(docs[sourcePath]).toBeUndefined()
            expect(result.updatedTask.projectMove).toMatchObject({ requestId, status: 'completed' })
        }
    )

    test.each(['source-edit', 'target-edit', 'membership', 'goal-access', 'parent-access'])(
        'detects %s changed during history transfer and retains the source',
        async change => {
            dependencies.copyChat.mockImplementationOnce(async () => {
                if (change === 'source-edit') docs[sourcePath].description = 'New edit'
                if (change === 'target-edit') docs[targetPath].description = 'New edit'
                if (change === 'membership') docs['projects/target'].userIds = []
                if (change === 'goal-access') docs[goalPath].isPublicFor = ['other-user']
                if (change === 'parent-access') docs[parentPath].isPublicFor = ['other-user']
            })
            await expect(move()).rejects.toThrow('partially completed')
            expect(docs[sourcePath]).toBeDefined()
            expect(docs[parentPath].subtaskIds).toContain('task-1')
        }
    )

    test('does not overwrite concurrent source or destination edits on retry after a partial move', async () => {
        dependencies.copyChat.mockRejectedValueOnce(new Error('transfer failed'))
        await expect(move()).rejects.toThrow('partially completed')
        docs[targetPath].name = 'New destination edit'
        await expect(move()).rejects.toThrow('Destination task changed')
        expect(docs[targetPath].name).toBe('New destination edit')
        docs[sourcePath].description = 'New source edit'
        await expect(move()).rejects.toThrow('Source task changed')
    })

    test('rechecks goal visibility and lock key and returns the final projection', async () => {
        dependencies.copyFeeds.mockImplementationOnce(async () => {
            docs[goalPath] = { isPublicFor: [0], lockKey: 'fresh-lock' }
        })
        const result = await move()
        expect(result.updatedTask.parentGoalIsPublicFor).toEqual([0])
        expect(result.updatedTask.lockKey).toBe('fresh-lock')
        expect(docs[targetPath].lockKey).toBe('fresh-lock')
    })

    test('combined completion follows the moved root workflow and reaches children', async () => {
        params.updateData.done = true
        params.updateData.completed = 123
        const result = await move()
        expect(result.updatedTask).toMatchObject({
            done: true,
            inDone: true,
            completed: 123,
            currentReviewerId: -2,
        })
        expect(docs['items/target/tasks/child-1']).toMatchObject({ parentDone: true, completed: 123 })
    })

    test('rejects an explicit destination assignee without target membership', async () => {
        params.updateData.userId = 'outsider'
        await expect(move()).rejects.toThrow('assignee is not a member')
        expect(writes).not.toHaveBeenCalled()
    })

    test('TaskService resolves the goal project and returns the actual persisted destination', async () => {
        const persist = jest
            .spyOn(require('./taskParentGoalMove'), 'persistTaskParentGoalMove')
            .mockImplementation((db, args) => persistTaskParentGoalMove(db, args, dependencies))
        try {
            const service = new TaskService({ database, enableFeeds: false, enableValidation: false })
            const result = await service.updateAndPersistTask({
                taskId: 'task-1',
                projectId: 'source',
                currentTask: docs[sourcePath],
                parentGoalId: 'goal-1',
                initiatorId: 'user-1',
            })
            expect(result.projectId).toBe('target')
            expect(result.updatedTask.parentGoalId).toBe('goal-1')
            expect(docs[sourcePath]).toBeUndefined()
        } finally {
            persist.mockRestore()
        }
    })

    test('TaskUpdateService uses the destination for estimation and reports a committed goal on failure', async () => {
        const persist = jest
            .spyOn(require('./taskParentGoalMove'), 'persistTaskParentGoalMove')
            .mockImplementation((db, args) => persistTaskParentGoalMove(db, args, dependencies))
        try {
            const service = new TaskUpdateService({ database, moment })
            service.taskService = new TaskService({ database, enableFeeds: false, enableValidation: false })
            service.performEstimationUpdate = jest.fn().mockRejectedValue(new Error('estimation unavailable'))
            await expect(
                service.performTaskUpdate(
                    docs[sourcePath],
                    'source',
                    'Source',
                    { parentGoalId: 'goal-1', estimation: 30 },
                    'user-1',
                    { uid: 'assistant-1' }
                )
            ).rejects.toThrow('Parent goal change committed in project target')
            expect(service.performEstimationUpdate).toHaveBeenCalledWith('target', 'task-1', expect.anything(), 30)
            expect(docs[sourcePath]).toBeUndefined()
            expect(docs[targetPath].parentGoalId).toBe('goal-1')
        } finally {
            persist.mockRestore()
        }
    })
})
