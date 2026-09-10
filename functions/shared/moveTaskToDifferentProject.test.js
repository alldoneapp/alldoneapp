'use strict'

jest.mock('firebase-admin', () => ({
    firestore: {
        FieldValue: { arrayUnion: value => ({ arrayUnion: value }) },
    },
}))

const { moveTaskToDifferentProject, prepareManualTaskMove } = require('./moveTaskToDifferentProject')

function createMoveDatabase(initial) {
    const state = new Map(Object.entries(initial))
    const operations = []
    const snapshot = value => ({ exists: value !== undefined, data: () => value })
    const doc = path => ({
        path,
        get: jest.fn(async () => snapshot(state.get(path))),
        set: jest.fn(async (data, options) => {
            operations.push(`set:${path}`)
            state.set(path, options?.merge ? { ...(state.get(path) || {}), ...data } : data)
        }),
        update: jest.fn(async data => {
            operations.push(`update:${path}`)
            if (!state.has(path)) throw new Error('not found')
            state.set(path, { ...state.get(path), ...data })
        }),
        delete: jest.fn(async () => {
            operations.push(`delete:${path}`)
            state.delete(path)
        }),
    })
    const database = {
        doc: jest.fn(doc),
        batch: jest.fn(() => ({
            set: (ref, data, options) => {
                operations.push(`batch-set:${ref.path}`)
                state.set(ref.path, options?.merge ? { ...(state.get(ref.path) || {}), ...data } : data)
            },
            commit: jest.fn(async () => operations.push('batch-commit')),
        })),
    }
    return { database, operations, state }
}

describe('prepareManualTaskMove', () => {
    const baseTask = {
        id: 'task-1',
        projectId: 'project-a',
        userId: 'owner-1',
        userIds: ['owner-1', 'reviewer-1'],
        creatorId: 'creator-1',
        currentReviewerId: 'reviewer-1',
        stepHistory: [-1, 'review'],
        observersIds: ['observer-1'],
        dueDateByObserversIds: { 'observer-1': 123 },
        estimationsByObserverIds: { 'observer-1': 30 },
        parentGoalId: 'goal-1',
        parentGoalIsPublicFor: [0],
        lockKey: 'goal-key',
        isPublicFor: [0],
        sortIndex: 1,
        done: false,
        subtaskIds: ['subtask-1'],
    }

    it('matches the manual client move reset while keeping the owner present in the target', () => {
        const moved = prepareManualTaskMove({
            task: baseTask,
            rootTask: baseTask,
            isRootTask: true,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            targetProjectUserIds: ['owner-1', 'creator-1'],
            actorId: 'actor-1',
            requestId: 'request-1',
            timestamp: 1000,
        })

        expect(moved).toMatchObject({
            projectId: 'project-b',
            userId: 'owner-1',
            userIds: ['owner-1'],
            currentReviewerId: 'owner-1',
            stepHistory: [-1],
            observersIds: [],
            dueDateByObserversIds: {},
            estimationsByObserverIds: {},
            parentGoalId: null,
            parentGoalIsPublicFor: null,
            lockKey: '',
            creatorId: 'creator-1',
            sortIndex: 1000,
            projectMove: { requestId: 'request-1', status: 'moving' },
        })
    })

    it('reassigns an owner missing from the target and pins calendar routing with feedback', () => {
        const task = {
            ...baseTask,
            isPublicFor: ['owner-1'],
            calendarData: { originalProjectId: 'calendar-home', projectRouting: { chosenProjectId: 'project-a' } },
        }
        const moved = prepareManualTaskMove({
            task,
            rootTask: task,
            isRootTask: true,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            targetProjectUserIds: [],
            actorId: 'actor-1',
            requestId: 'request-1',
            timestamp: 1000,
        })

        expect(moved.userId).toBe('actor-1')
        expect(moved.isPublicFor).toEqual(['owner-1', 'actor-1'])
        expect(moved.creatorId).toBe('actor-1')
        expect(moved.calendarData).toMatchObject({
            pinnedToProjectId: 'project-b',
            projectRoutingFeedback: {
                feedbackId: 'request-1',
                requestedByUserId: 'actor-1',
                syncProjectId: 'calendar-home',
                movedFromProjectId: 'project-a',
                movedToProjectId: 'project-b',
            },
        })
    })

    it('promotes a moved subtask to a root task', () => {
        const task = { ...baseTask, parentId: 'parent-1', isSubtask: true, done: true, completed: null }
        const moved = prepareManualTaskMove({
            task,
            rootTask: task,
            isRootTask: true,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            targetProjectUserIds: ['owner-1'],
            actorId: 'actor-1',
            requestId: 'request-1',
            timestamp: 1000,
        })

        expect(moved).toMatchObject({
            parentId: null,
            isSubtask: false,
            parentDone: false,
            inDone: true,
            completed: 1000,
        })
    })
})

describe('moveTaskToDifferentProject manual orchestration', () => {
    it('copies task data and linked history before deleting the source', async () => {
        const sourcePath = 'items/project-a/tasks/task-1'
        const subtaskPath = 'items/project-a/tasks/subtask-1'
        const { database, operations, state } = createMoveDatabase({
            [sourcePath]: {
                id: 'task-1',
                userId: 'user-1',
                creatorId: 'user-1',
                isPublicFor: [0],
                subtaskIds: ['subtask-1'],
                created: 10,
            },
            [subtaskPath]: {
                id: 'subtask-1',
                userId: 'user-1',
                creatorId: 'user-1',
                isPublicFor: [0],
                subtaskIds: [],
                parentId: 'task-1',
            },
            'followers/project-a/tasks/task-1': { usersFollowing: ['user-1'] },
        })
        const moveManualChat = jest.fn(async ({ objectId }) => operations.push(`chat:${objectId}`))
        const copyInnerFeeds = jest.fn(async (_admin, _source, _target, _type, id) => operations.push(`feeds:${id}`))

        const result = await moveTaskToDifferentProject({
            database,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            taskId: 'task-1',
            editorId: 'user-1',
            manual: true,
            requestId: 'request-1',
            sourceProject: { id: 'project-a', name: 'Inbox' },
            targetProject: { id: 'project-b', name: 'Product', userIds: ['user-1'] },
            moveManualChat,
            copyInnerFeeds,
        })

        expect(result).toMatchObject({ moved: true, movedTaskCount: 2 })
        expect(state.get('items/project-b/tasks/task-1')).toMatchObject({
            projectId: 'project-b',
            projectMove: { requestId: 'request-1', status: 'completed' },
        })
        expect(state.get('items/project-b/tasks/subtask-1')).toMatchObject({
            projectId: 'project-b',
            parentId: 'task-1',
        })
        expect(operations.indexOf('chat:task-1')).toBeLessThan(operations.indexOf(`delete:${sourcePath}`))
        expect(operations.indexOf('feeds:task-1')).toBeLessThan(operations.indexOf(`delete:${sourcePath}`))
        expect(moveManualChat).toHaveBeenCalledTimes(2)
        expect(copyInnerFeeds).toHaveBeenCalledTimes(2)
    })

    it('treats a retry after source deletion as already completed', async () => {
        const { database } = createMoveDatabase({
            'items/project-b/tasks/task-1': { id: 'task-1', projectMove: { requestId: 'request-1' } },
        })

        await expect(
            moveTaskToDifferentProject({
                database,
                sourceProjectId: 'project-a',
                targetProjectId: 'project-b',
                taskId: 'task-1',
                requestId: 'request-1',
                manual: true,
            })
        ).resolves.toMatchObject({ moved: false, reason: 'already_moved' })
    })
})
