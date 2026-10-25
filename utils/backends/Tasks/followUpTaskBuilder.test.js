import { buildFollowUpTask, resolveFollowUpGoalLink } from './followUpTaskBuilder'

const buildSourceTask = overrides => ({
    id: 'source-task',
    name: 'Ship the change',
    extendedName: 'Ship the change',
    userId: 'owner-1',
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    linkedParentTasksIds: [],
    linkedParentNotesIds: [],
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    ...overrides,
})

const build = (sourceTask, goalLink) =>
    buildFollowUpTask({
        defaultTask: { recurrence: 'never', parentGoalId: null, parentGoalIsPublicFor: null },
        sourceTask,
        taskId: 'follow-up-task',
        creatorId: 'creator-1',
        dueDate: 123456789,
        goalLink,
    })

describe('buildFollowUpTask goal inheritance (AT-2615)', () => {
    it('links the follow-up to the source task goal with the matching visibility projection', () => {
        const parentGoalIsPublicFor = [0, 'member-1']

        const followUp = build(
            buildSourceTask({
                parentGoalId: 'goal-1',
                parentGoalIsPublicFor,
                lockKey: 'goal-lock',
            })
        )

        expect(followUp).toMatchObject({
            id: 'follow-up-task',
            followUpSourceTaskId: 'source-task',
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: [0, 'member-1'],
            lockKey: 'goal-lock',
        })
        expect(followUp.parentGoalIsPublicFor).not.toBe(parentGoalIsPublicFor)
    })

    it('keeps an unlinked follow-up outside every goal', () => {
        expect(build(buildSourceTask({ parentGoalIsPublicFor: [0, 'stale-member'] }))).toMatchObject({
            parentGoalId: null,
            parentGoalIsPublicFor: null,
        })
    })

    it('recovers a missing legacy visibility projection from the linked goal', async () => {
        const sourceTask = buildSourceTask({ parentGoalId: 'goal-1', parentGoalIsPublicFor: undefined })
        const loadGoal = jest.fn().mockResolvedValue({ id: 'goal-1', isPublicFor: [0, 'member-2'] })

        const goalLink = await resolveFollowUpGoalLink({ projectId: 'project-1', sourceTask, loadGoal })

        expect(loadGoal).toHaveBeenCalledWith('project-1', 'goal-1')
        expect(build(sourceTask, goalLink)).toMatchObject({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: [0, 'member-2'],
        })
    })

    it('preserves the goal id if a legacy visibility projection cannot be recovered', async () => {
        const sourceTask = buildSourceTask({ parentGoalId: 'goal-1', parentGoalIsPublicFor: undefined })
        const error = new Error('offline')
        const onGoalReadError = jest.fn()

        const goalLink = await resolveFollowUpGoalLink({
            projectId: 'project-1',
            sourceTask,
            loadGoal: jest.fn().mockRejectedValue(error),
            onGoalReadError,
        })

        expect(goalLink).toEqual({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: null,
        })
        expect(onGoalReadError).toHaveBeenCalledWith(error)
    })
})
