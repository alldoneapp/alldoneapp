import {
    GOAL_MILESTONES_CADENCE_MONTHLY,
    MILESTONE_TYPE_LINEAR,
    getDynamicMilestoneOptions,
    getGoalMilestoneTransition,
} from './GoalMilestonesHelper'

describe('getGoalMilestoneTransition', () => {
    it('keeps Someday as the cleanup date when moving a goal to its first milestone', () => {
        const someday = Number.MAX_SAFE_INTEGER
        const milestoneDate = 1782777600000
        const goal = {
            id: 'goal-1',
            startingMilestoneDate: someday,
            completionMilestoneDate: someday,
            scheduleMode: 'fixed',
        }

        const transition = getGoalMilestoneTransition(goal, {
            startingMilestoneDate: milestoneDate,
            completionMilestoneDate: milestoneDate,
        })

        expect(transition.previousCompletionMilestoneDate).toBe(someday)
        expect(transition.updatedGoal.startingMilestoneDate).toBe(milestoneDate)
        expect(transition.updatedGoal.completionMilestoneDate).toBe(milestoneDate)
    })

    it('keeps the former milestone as the cleanup date when moving a goal to Someday', () => {
        const milestoneDate = 1782777600000
        const someday = Number.MAX_SAFE_INTEGER
        const goal = {
            id: 'goal-1',
            startingMilestoneDate: milestoneDate,
            completionMilestoneDate: milestoneDate,
            scheduleMode: 'fixed',
        }

        const transition = getGoalMilestoneTransition(goal, {
            startingMilestoneDate: someday,
            completionMilestoneDate: someday,
        })

        expect(transition.previousCompletionMilestoneDate).toBe(milestoneDate)
        expect(transition.updatedGoal.startingMilestoneDate).toBe(someday)
        expect(transition.updatedGoal.completionMilestoneDate).toBe(someday)
    })
})

describe('getDynamicMilestoneOptions', () => {
    it('uses the configured number of dynamic periods even when project milestones are fixed', () => {
        const startTimestamp = Date.UTC(2026, 6, 3, 12)
        const options = getDynamicMilestoneOptions(
            {
                mode: 'manual',
                cadence: GOAL_MILESTONES_CADENCE_MONTHLY,
                timezone: 'UTC',
                cadenceStartDate: startTimestamp,
                futureMilestonesToCreate: 2,
            },
            startTimestamp
        )

        expect(options).toHaveLength(2)
        expect(options.map(option => option.periodKey)).toEqual(['monthly:2026-07-01', 'monthly:2026-08-01'])
        expect(options.every(option => option.milestoneType === MILESTONE_TYPE_LINEAR)).toBe(true)
    })
})
