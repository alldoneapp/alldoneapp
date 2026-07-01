import { getPreviousOpenMilestoneDate, shouldShowMilestoneWithoutGoals } from './GoalsBoardMilestonesHelper'

describe('GoalsBoardMilestonesHelper', () => {
    describe('shouldShowMilestoneWithoutGoals', () => {
        const defaultOptions = {
            inAllProjects: false,
            inDone: false,
            milestoneIndex: 0,
            isAutomaticMode: false,
            isLinearMilestone: false,
            isBacklog: false,
        }

        it('shows the earliest open milestone in a selected project', () => {
            expect(shouldShowMilestoneWithoutGoals(defaultOptions)).toBe(true)
        })

        it('keeps later empty manual milestones hidden', () => {
            expect(shouldShowMilestoneWithoutGoals({ ...defaultOptions, milestoneIndex: 1 })).toBe(false)
        })

        it('shows later linear milestones in automatic mode', () => {
            expect(
                shouldShowMilestoneWithoutGoals({
                    ...defaultOptions,
                    milestoneIndex: 1,
                    isAutomaticMode: true,
                    isLinearMilestone: true,
                })
            ).toBe(true)
        })

        it('shows the earliest open milestone in the all-projects board', () => {
            expect(shouldShowMilestoneWithoutGoals({ ...defaultOptions, inAllProjects: true })).toBe(true)
        })

        it('keeps later empty milestones hidden in the all-projects board', () => {
            expect(
                shouldShowMilestoneWithoutGoals({
                    ...defaultOptions,
                    inAllProjects: true,
                    milestoneIndex: 1,
                    isAutomaticMode: true,
                    isLinearMilestone: true,
                })
            ).toBe(false)
        })

        it('does not add empty milestones to the done board', () => {
            expect(shouldShowMilestoneWithoutGoals({ ...defaultOptions, inDone: true })).toBe(false)
        })

        it('does not treat the backlog as the active milestone', () => {
            expect(shouldShowMilestoneWithoutGoals({ ...defaultOptions, isBacklog: true })).toBe(false)
        })
    })

    describe('getPreviousOpenMilestoneDate', () => {
        const openMilestones = [
            { id: 'june', date: 100 },
            { id: 'july', date: 200 },
            { id: 'august', date: 300 },
        ]

        it('returns zero for the first open milestone', () => {
            expect(getPreviousOpenMilestoneDate('june', openMilestones, 'backlog')).toBe(0)
        })

        it('uses the preceding raw milestone even when it is not on the board', () => {
            expect(getPreviousOpenMilestoneDate('august', openMilestones, 'backlog')).toBe(200)
        })

        it('uses the final open milestone as the backlog boundary', () => {
            expect(getPreviousOpenMilestoneDate('backlog', openMilestones, 'backlog')).toBe(300)
        })
    })
})
