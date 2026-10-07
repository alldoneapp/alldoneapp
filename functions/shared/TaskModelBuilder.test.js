const { createTaskObject, resolveParentGoalIsPublicFor, FEED_PUBLIC_FOR_ALL } = require('./TaskModelBuilder')

const baseParams = {
    name: 'Check costs again',
    userId: 'user-1',
    projectId: 'project-1',
    taskId: 'task-1',
}

describe('TaskModelBuilder parent goal privacy', () => {
    // `processTaskChange` (utils/backends/openTasks.js) groups a task under its goal only when
    // `parentGoalIsPublicFor` is an array the reader appears in. A goal id without that array is
    // filed under "no goal" while still pointing at one - the shape every recurrence copy used to
    // ship with, because the builder hardcoded the field to null.
    it('keeps the parent goal privacy the caller passes alongside the goal id', () => {
        const task = createTaskObject({
            ...baseParams,
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: ['user-1', 'user-2'],
        })

        expect(task.parentGoalId).toBe('goal-1')
        expect(task.parentGoalIsPublicFor).toEqual(['user-1', 'user-2'])
    })

    it('falls back to public-for-all when a goal id arrives without a usable privacy array', () => {
        expect(createTaskObject({ ...baseParams, parentGoalId: 'goal-1' }).parentGoalIsPublicFor).toEqual([
            FEED_PUBLIC_FOR_ALL,
        ])
        expect(
            createTaskObject({ ...baseParams, parentGoalId: 'goal-1', parentGoalIsPublicFor: null })
                .parentGoalIsPublicFor
        ).toEqual([FEED_PUBLIC_FOR_ALL])
        expect(
            createTaskObject({ ...baseParams, parentGoalId: 'goal-1', parentGoalIsPublicFor: [] }).parentGoalIsPublicFor
        ).toEqual([FEED_PUBLIC_FOR_ALL])
    })

    it('stores null when the task has no parent goal, whatever the caller passes', () => {
        expect(createTaskObject(baseParams).parentGoalIsPublicFor).toBeNull()
        expect(
            createTaskObject({ ...baseParams, parentGoalIsPublicFor: [FEED_PUBLIC_FOR_ALL] }).parentGoalIsPublicFor
        ).toBeNull()
        expect(resolveParentGoalIsPublicFor(null, ['user-1'])).toBeNull()
    })
})
