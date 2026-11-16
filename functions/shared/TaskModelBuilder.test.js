const { createTaskObject, resolveParentGoalIsPublicFor, FEED_PUBLIC_FOR_ALL } = require('./TaskModelBuilder')

const baseParams = {
    name: 'Check costs again',
    userId: 'user-1',
    projectId: 'project-1',
    taskId: 'task-1',
}

describe('TaskModelBuilder parent goal privacy', () => {
    it('only suppresses automatic goal routing when explicitly requested', () => {
        expect(createTaskObject(baseParams).goalSuggestion).toBeUndefined()
        expect(createTaskObject({ ...baseParams, skipAutomaticGoalRouting: true }).goalSuggestion).toMatchObject({
            status: 'superseded',
            source: 'assistant_parent_goal',
            projectId: 'project-1',
            resolvedBy: 'user-1',
        })
    })
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

// AT-3065: tasks built here started with stepHistory ['Open'], which the workflow did not read as
// Open, so a delegated task never entered its workflow. The step history uses OPEN_STEP (-1) like
// tasks created in the app; the estimations keep their 'Open' key, which TaskService normalizes.
describe('TaskModelBuilder workflow position', () => {
    it("starts a task at the workflow's Open step", () => {
        const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
        const task = createTaskObject(baseParams)
        expect(task.stepHistory).toEqual([OPEN_STEP])
        expect(task.estimations).toEqual({ Open: 0 })
    })

    it('keeps a step history the caller passes', () => {
        expect(createTaskObject({ ...baseParams, stepHistory: [-1, 'step-1'] }).stepHistory).toEqual([-1, 'step-1'])
    })
})
