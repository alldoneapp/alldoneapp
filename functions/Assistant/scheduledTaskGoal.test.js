const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { buildScheduledRunGoalFields, readScheduledTaskGoal } = require('./scheduledTaskGoal')

const P = 'p1'
const USER = 'karsten'

const seeded = goals =>
    createFakeFirestore(Object.fromEntries(Object.entries(goals).map(([id, data]) => [`goals/${P}/items/${id}`, data])))

describe('the goal a scheduled task files its runs under', () => {
    test('a run gets the goal as create_task would give it, with no automatic routing on top', async () => {
        const db = seeded({ g1: { extendedName: 'Pick the winning segment', isPublicFor: [0, USER], lockKey: 'k' } })
        const fields = await buildScheduledRunGoalFields(db, {
            scheduledTask: { id: 't1', parentGoalId: 'g1' },
            projectId: P,
            userId: USER,
        })
        expect(fields).toEqual({
            parentGoalId: 'g1',
            parentGoalIsPublicFor: [0, USER],
            lockKey: 'k',
            skipAutomaticGoalRouting: true,
        })
    })

    test('a goal stored without an audience counts as visible to the project', async () => {
        const db = seeded({ g1: { extendedName: 'Old goal' } })
        const goal = await readScheduledTaskGoal(db, { projectId: P, goalId: 'g1', userId: USER })
        expect(goal.isPublicFor).toEqual([0])
    })

    test('no goal, a missing goal or one the user cannot see leaves the run unfiled', async () => {
        const db = seeded({ secret: { isPublicFor: ['someone-else'] } })
        const call = scheduledTask => buildScheduledRunGoalFields(db, { scheduledTask, projectId: P, userId: USER })
        await expect(call({ id: 't1' })).resolves.toEqual({})
        await expect(call({ id: 't1', parentGoalId: 'gone' })).resolves.toEqual({})
        await expect(call({ id: 't1', parentGoalId: 'secret' })).resolves.toEqual({})
        await expect(call({ id: 't1', parentGoalId: 'a/b' })).resolves.toEqual({})
    })

    test('a failed read never stops the run', async () => {
        const db = { doc: () => ({ get: async () => Promise.reject(new Error('unavailable')) }) }
        await expect(
            buildScheduledRunGoalFields(db, {
                scheduledTask: { id: 't1', parentGoalId: 'g1' },
                projectId: P,
                userId: USER,
            })
        ).resolves.toEqual({})
    })
})
