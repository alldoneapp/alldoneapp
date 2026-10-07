const { TaskService } = require('./TaskService')
const TaskUpdateService = require('./TaskUpdateService')
const moment = require('moment-timezone')

describe('persisting assistant parent goal changes', () => {
    let docs, database, service, writes
    const taskPath = 'items/project-1/tasks/task-1'
    const goalPath = 'goals/project-1/items/goal-1'
    const params = overrides => ({
        taskId: 'task-1',
        projectId: 'project-1',
        initiatorId: 'user-1',
        feedUser: { uid: 'assistant-1', name: 'Assistant' },
        ...overrides,
    })

    beforeEach(async () => {
        docs = {
            'users/user-1': { timezone: 0 },
            'projects/project-1': { userIds: ['user-1'] },
            [goalPath]: { isPublicFor: ['user-1'], lockKey: 'locked-goal' },
            [taskPath]: {
                id: 'task-1',
                name: 'Task',
                userId: 'user-1',
                isPublicFor: [0],
                parentGoalId: 'old-goal',
                parentGoalIsPublicFor: [0],
                lockKey: 'old-lock',
                sortIndex: 1,
            },
        }
        writes = jest.fn((ref, data) => {
            docs[ref.path] = { ...docs[ref.path], ...data }
        })
        const doc = path => ({
            path,
            get: jest.fn(async () => ({ exists: !!docs[path], data: () => docs[path] })),
            update: jest.fn(async data => writes({ path }, data)),
        })
        database = {
            doc,
            collection: path => ({ doc: id => doc(`${path}/${id}`) }),
            runTransaction: jest.fn(async callback => {
                const pending = []
                const result = await callback({
                    get: ref => ref.get(),
                    update: (ref, data) => pending.push([ref, data]),
                })
                pending.forEach(args => writes(...args))
                return result
            }),
        }
        service = new TaskService({ database, enableFeeds: false, enableValidation: false })
        await service.initialize()
    })

    const update = fields => service.updateAndPersistTask(params({ currentTask: { ...docs[taskPath] }, ...fields }))

    test('assigns and changes the goal with privacy, lock, ordering and actor metadata', async () => {
        const result = await update({ parentGoalId: 'goal-1' })
        expect(result.changes).toContain('parent goal')
        expect(docs[taskPath]).toMatchObject({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: ['user-1'],
            lockKey: 'locked-goal',
            lastEditorId: 'assistant-1',
        })
        expect(docs[taskPath].sortIndex).toBeGreaterThan(1)
        expect(database.runTransaction).toHaveBeenCalledTimes(1)
        expect(result.updatedTask.parentGoalId).toBe('goal-1')
    })

    test('clears goal, visibility and lock without changing task privacy', async () => {
        const result = await update({ parentGoalId: null })
        expect(result.changes).toContain('parent goal cleared')
        expect(docs[taskPath]).toMatchObject({
            parentGoalId: null,
            parentGoalIsPublicFor: null,
            lockKey: '',
            isPublicFor: [0],
        })
    })

    test('an unrelated edit preserves the association and avoids a goal transaction', async () => {
        await update({ name: 'Renamed' })
        expect(docs[taskPath]).toMatchObject({ parentGoalId: 'old-goal', lockKey: 'old-lock' })
        expect(database.runTransaction).not.toHaveBeenCalled()
    })

    test('repeating the same complete association is a no-op', async () => {
        await update({ parentGoalId: 'goal-1' })
        writes.mockClear()
        const result = await update({ parentGoalId: 'goal-1' })
        expect(result.changes).toEqual([])
        expect(result.persisted).toBe(false)
        expect(writes).not.toHaveBeenCalled()
    })

    test('repairs a legacy association missing goal privacy', async () => {
        docs[taskPath].parentGoalId = 'goal-1'
        delete docs[taskPath].parentGoalIsPublicFor
        await update({ parentGoalId: 'goal-1' })
        expect(docs[taskPath].parentGoalIsPublicFor).toEqual(['user-1'])
    })

    test.each(['pending', 'classifying'])(
        'supersedes %s routing, including clearing an unlinked task',
        async status => {
            docs[taskPath] = {
                ...docs[taskPath],
                parentGoalId: null,
                parentGoalIsPublicFor: null,
                lockKey: '',
                goalSuggestion: { status, claimId: 'router-claim' },
            }
            await update({ parentGoalId: null })
            expect(docs[taskPath].goalSuggestion).toMatchObject({
                status: 'superseded',
                resolvedBy: 'user-1',
                claimId: 'router-claim',
            })
        }
    )

    test.each(['membership', 'task-privacy', 'goal-privacy', 'deleted-goal', 'deleted-task'])(
        'rechecks %s in the write transaction without persisting any changes',
        async change => {
            const prepared = await service.updateTask(params({ currentTask: docs[taskPath], parentGoalId: 'goal-1' }))
            if (change === 'membership') docs['projects/project-1'].userIds = []
            if (change === 'task-privacy') docs[taskPath].isPublicFor = ['other-user']
            if (change === 'goal-privacy') docs[goalPath].isPublicFor = ['other-user']
            if (change === 'deleted-goal') delete docs[goalPath]
            if (change === 'deleted-task') delete docs[taskPath]
            await expect(service.persistTaskUpdate(prepared, { projectId: 'project-1' })).rejects.toThrow()
            expect(writes).not.toHaveBeenCalled()
        }
    )

    test('persists goal privacy changed after preflight and returns the persisted projection', async () => {
        const prepared = await service.updateTask(params({ currentTask: docs[taskPath], parentGoalId: 'goal-1' }))
        docs[goalPath].isPublicFor = [0]
        const result = await service.persistTaskUpdate(prepared, { projectId: 'project-1' })
        expect(docs[taskPath].parentGoalIsPublicFor).toEqual([0])
        expect(result.updatedTask.parentGoalIsPublicFor).toEqual([0])
    })

    test('invalid goals abort combined estimation and name edits before any writes', async () => {
        const updateService = new TaskUpdateService({ database, moment })
        updateService.taskService = service
        updateService.performEstimationUpdate = jest.fn()
        await expect(
            updateService.performTaskUpdate(
                docs[taskPath],
                'project-1',
                'Project',
                { parentGoalId: 'missing-goal', estimation: 30, name: 'Renamed' },
                'user-1',
                { uid: 'assistant-1' }
            )
        ).rejects.toThrow('Parent goal not found or not accessible')
        expect(updateService.performEstimationUpdate).not.toHaveBeenCalled()
        expect(writes).not.toHaveBeenCalled()
    })

    test('rejects conflicting hierarchy fields and unauthenticated goal updates', async () => {
        await expect(update({ parentId: 'parent-task', parentGoalId: 'goal-1' })).rejects.toThrow('separate calls')
        await expect(update({ parentGoalId: 'goal-1', initiatorId: undefined })).rejects.toThrow(
            'Authenticated user is required'
        )
        expect(writes).not.toHaveBeenCalled()
    })

    test('a valid combined name and goal update writes both together', async () => {
        await update({ parentGoalId: 'goal-1', name: 'Renamed' })
        expect(writes).toHaveBeenCalledTimes(1)
        expect(docs[taskPath]).toMatchObject({ parentGoalId: 'goal-1', name: 'Renamed', extendedName: 'Renamed' })
    })

    test('refuses direct subtask goal edits without detachment', async () => {
        docs[taskPath].parentId = 'parent-task'
        docs[taskPath].isSubtask = true
        await expect(update({ parentGoalId: 'goal-1' })).rejects.toThrow('Subtasks inherit their parent goal')
        expect(writes).not.toHaveBeenCalled()
    })

    test('bulk goal edits validate each task and report failures without changing inaccessible tasks', async () => {
        const { TaskRetrievalService } = require('./TaskRetrievalService')
        const privatePath = 'items/project-1/tasks/private-task'
        docs[privatePath] = { ...docs[taskPath], id: 'private-task', isPublicFor: ['other-user'] }
        const initialize = jest.spyOn(TaskRetrievalService.prototype, 'initialize').mockResolvedValue(undefined)
        const getTasks = jest.spyOn(TaskRetrievalService.prototype, 'getTasks').mockResolvedValue({
            tasks: [docs[taskPath], docs[privatePath]],
        })
        try {
            const updateService = new TaskUpdateService({ database, moment })
            updateService.taskService = service
            const result = await updateService.bulkUpdateTasks(
                'user-1',
                { projectId: 'project-1' },
                { parentGoalId: 'goal-1' },
                { feedUser: { uid: 'assistant-1' } }
            )
            expect(result.updated.map(task => task.id)).toEqual(['task-1'])
            expect(result.failed).toEqual([
                expect.objectContaining({ id: 'private-task', error: expect.stringContaining('access') }),
            ])
            expect(docs[taskPath].parentGoalId).toBe('goal-1')
            expect(docs[privatePath].parentGoalId).toBe('old-goal')
        } finally {
            initialize.mockRestore()
            getTasks.mockRestore()
        }
    })

    test('does not overwrite a routing decision made after the preflight read', async () => {
        docs[taskPath].goalSuggestion = { status: 'classifying', claimId: 'old-claim' }
        const prepared = await service.updateTask(params({ currentTask: docs[taskPath], parentGoalId: 'goal-1' }))
        docs[taskPath].goalSuggestion = { status: 'dismissed', claimId: 'new-claim' }
        await service.persistTaskUpdate(prepared, { projectId: 'project-1' })
        expect(docs[taskPath].goalSuggestion).toEqual({ status: 'dismissed', claimId: 'new-claim' })
    })
})
