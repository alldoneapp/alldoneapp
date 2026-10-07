const { normalizeParentGoalId, resolveTaskParentGoal, buildTaskParentGoalFields } = require('./taskParentGoal')

describe('assistant parent goal validation', () => {
    const userId = 'user-1'
    const projectId = 'project-1'
    let docs, database

    beforeEach(() => {
        docs = {
            'users/user-1': {},
            'projects/project-1': { userIds: [userId] },
            'goals/project-1/items/goal-1': { isPublicFor: [0], lockKey: 'goal-lock' },
        }
        const doc = path => ({
            get: jest.fn(async () => ({ exists: !!docs[path], data: () => docs[path] })),
        })
        database = {
            doc: jest.fn(doc),
            collection: path => ({ doc: id => doc(`${path}/${id}`) }),
        }
    })

    test('omission leaves existing callers alone without querying the database', async () => {
        expect(await resolveTaskParentGoal(database, userId, projectId, undefined)).toBeUndefined()
        expect(database.doc).not.toHaveBeenCalled()
    })

    test.each(['', ' ', 'goals/other', '.', '..', ' . ', ' .. ', 'ä'.repeat(751), 42, false, {}, []])(
        'rejects invalid IDs: %j',
        value => {
            expect(() => normalizeParentGoalId(value)).toThrow('parentGoalId must be')
        }
    )

    test('uses the actual goal privacy and lock key, including trimmed IDs', async () => {
        docs['goals/project-1/items/goal-1'].isPublicFor = [userId]
        const goal = await resolveTaskParentGoal(database, userId, projectId, ' goal-1 ')
        expect(buildTaskParentGoalFields(goal)).toEqual({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: [userId],
            lockKey: 'goal-lock',
        })
    })

    test('clearing removes both goal fields and the inherited lock', async () => {
        const goal = await resolveTaskParentGoal(database, userId, projectId, null)
        expect(buildTaskParentGoalFields(goal)).toEqual({
            parentGoalId: null,
            parentGoalIsPublicFor: null,
            lockKey: '',
        })
    })

    test.each(['missing', 'private', 'empty', 'legacy', 'other-project'])(
        'denies inaccessible goals: %s',
        async kind => {
            if (kind === 'missing' || kind === 'other-project') delete docs['goals/project-1/items/goal-1']
            if (kind === 'private') docs['goals/project-1/items/goal-1'].isPublicFor = ['other-user']
            if (kind === 'empty') docs['goals/project-1/items/goal-1'].isPublicFor = []
            if (kind === 'legacy') delete docs['goals/project-1/items/goal-1'].isPublicFor
            if (kind === 'other-project') docs['goals/project-2/items/goal-1'] = { isPublicFor: [0] }
            await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1')).rejects.toThrow(
                'Parent goal not found or not accessible'
            )
        }
    )

    test.each(['goal-1', null])('membership is required for assignment and clearing: %j', async goalId => {
        docs['projects/project-1'].userIds = ['other-user']
        await expect(resolveTaskParentGoal(database, userId, projectId, goalId)).rejects.toThrow(
            'User does not have access to this project'
        )
    })

    test('resolves a goal from another project only after confirming membership', async () => {
        delete docs['goals/project-1/items/goal-1']
        docs['users/user-1'].projectIds = ['project-1', 'project-2']
        docs['projects/project-2'] = { userIds: [userId] }
        docs['goals/project-2/items/goal-1'] = { isPublicFor: [0], lockKey: 'target-lock' }
        expect(await resolveTaskParentGoal(database, userId, projectId, 'goal-1')).toMatchObject({
            projectId: 'project-2',
            id: 'goal-1',
            lockKey: 'target-lock',
        })
        docs['projects/project-2'].userIds = []
        await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1')).rejects.toThrow('not accessible')
    })

    test('copied IDs require an explicit project when the task project has no match', async () => {
        delete docs['goals/project-1/items/goal-1']
        docs['users/user-1'].projectIds = ['project-2', 'project-3']
        for (const id of ['project-2', 'project-3']) {
            docs[`projects/${id}`] = { userIds: [userId] }
            docs[`goals/${id}/items/goal-1`] = { isPublicFor: [0] }
        }
        await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1')).rejects.toThrow('ambiguous')
        expect(await resolveTaskParentGoal(database, userId, projectId, 'goal-1', 'project-3')).toMatchObject({
            projectId: 'project-3',
        })
    })

    test('explicit goal project is validated and a null goal never requests a move', async () => {
        await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1', '../bad')).rejects.toThrow()
        docs['projects/project-2'] = { userIds: ['other-user'] }
        await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1', 'project-2')).rejects.toThrow(
            'access'
        )
        expect(await resolveTaskParentGoal(database, userId, projectId, null, 'project-2')).toBeNull()
    })

    test('requires the human caller, even when an assistant can see the goal', async () => {
        docs['goals/project-1/items/goal-1'].isPublicFor = ['assistant-1']
        await expect(resolveTaskParentGoal(database, userId, projectId, 'goal-1')).rejects.toThrow('not accessible')
        await expect(resolveTaskParentGoal(database, null, projectId, 'goal-1')).rejects.toThrow(
            'Authenticated user is required'
        )
    })
})
