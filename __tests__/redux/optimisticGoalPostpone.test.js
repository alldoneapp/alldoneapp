import { clearOptimisticGoalPostpone, setOptimisticGoalPostpone } from '../../redux/actions'
import { initialState, theReducer } from '../../redux/store'

// AT-2160
describe('optimistic goal postpone reducer', () => {
    it('starts empty', () => {
        expect(theReducer(undefined, {}).optimisticGoalPostpones).toEqual({})
    })

    it('records a postpone under a project-scoped key', () => {
        const state = theReducer(initialState, setOptimisticGoalPostpone('p1', 'g1', 123, 456))
        expect(state.optimisticGoalPostpones).toEqual({ p1_g1: { date: 123, startedAt: 456 } })
    })

    it('keeps postpones for different goals side by side', () => {
        let state = theReducer(initialState, setOptimisticGoalPostpone('p1', 'g1', 123, 456))
        state = theReducer(state, setOptimisticGoalPostpone('p1', 'g2', 789, 999))
        expect(Object.keys(state.optimisticGoalPostpones).sort()).toEqual(['p1_g1', 'p1_g2'])
    })

    it('clears only the goal it is told to clear', () => {
        let state = theReducer(initialState, setOptimisticGoalPostpone('p1', 'g1', 123, 456))
        state = theReducer(state, setOptimisticGoalPostpone('p1', 'g2', 789, 999))
        state = theReducer(state, clearOptimisticGoalPostpone('p1', 'g1'))
        expect(state.optimisticGoalPostpones).toEqual({ p1_g2: { date: 789, startedAt: 999 } })
    })

    it('is a no-op when clearing something that was never recorded', () => {
        const state = theReducer(initialState, clearOptimisticGoalPostpone('p1', 'ghost'))
        expect(state).toBe(initialState)
    })

    it('does not mutate the previous state', () => {
        const before = theReducer(initialState, setOptimisticGoalPostpone('p1', 'g1', 123, 456))
        const snapshot = { ...before.optimisticGoalPostpones }
        theReducer(before, setOptimisticGoalPostpone('p1', 'g2', 789, 999))
        expect(before.optimisticGoalPostpones).toEqual(snapshot)
    })
})
