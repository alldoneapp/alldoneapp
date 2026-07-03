import { getGoalMilestoneTransition } from './GoalMilestonesHelper'

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
