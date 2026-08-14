import { goalSelectionId, shouldUnselectGoal } from './goalSelectionToggle'

const GOAL = { id: 'goal-finetuning', name: 'Finetuning & Bugfixing' }
const OTHER_GOAL = { id: 'goal-openclaw', name: 'OpenClaw' }

describe('goalSelectionId', () => {
    it('reads a goal id and normalizes every empty shape to null', () => {
        expect(goalSelectionId(GOAL)).toBe(GOAL.id)
        expect(goalSelectionId(null)).toBeNull()
        expect(goalSelectionId(undefined)).toBeNull()
        expect(goalSelectionId({})).toBeNull()
    })
})

describe('shouldUnselectGoal', () => {
    it('unselects a goal that was already selected when the picker opened', () => {
        expect(shouldUnselectGoal(GOAL, GOAL, GOAL.id)).toBe(true)
    })

    it('keeps a select click when the router assigned that goal after the picker opened', () => {
        expect(shouldUnselectGoal(GOAL, GOAL, null)).toBe(false)
    })

    it('keeps a select click when another background update moved the task to that goal', () => {
        expect(shouldUnselectGoal(GOAL, GOAL, OTHER_GOAL.id)).toBe(false)
    })

    it('selects a different goal than the currently assigned one', () => {
        expect(shouldUnselectGoal(OTHER_GOAL, GOAL, GOAL.id)).toBe(false)
    })

    it('selects when the task has no goal', () => {
        expect(shouldUnselectGoal(GOAL, null, null)).toBe(false)
    })

    it('never unselects on an empty item click', () => {
        expect(shouldUnselectGoal(null, GOAL, GOAL.id)).toBe(false)
        expect(shouldUnselectGoal(undefined, GOAL, GOAL.id)).toBe(false)
    })

    it('toggles off after the user selected the goal through this picker', () => {
        let userChoice = null
        expect(shouldUnselectGoal(GOAL, null, userChoice)).toBe(false)

        userChoice = goalSelectionId(GOAL)
        expect(shouldUnselectGoal(GOAL, GOAL, userChoice)).toBe(true)
    })
})
