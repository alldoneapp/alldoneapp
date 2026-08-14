/**
 * @jest-environment jsdom
 */

import store from '../../redux/store'
import { setLastVisitedScreen } from '../../redux/actions'
import SharedHelper from '../../utils/SharedHelper'

const seedHistory = entries => {
    store.dispatch(setLastVisitedScreen(entries))
    return store.getState().lastVisitedScreen
}

describe('SharedHelper.onHistoryPop', () => {
    let processUrlAsLoggedIn

    beforeEach(() => {
        processUrlAsLoggedIn = jest.spyOn(SharedHelper, 'processUrlAsLoggedIn').mockImplementation(() => {})
    })

    afterEach(() => {
        processUrlAsLoggedIn.mockRestore()
    })

    it('navigates to the last entry that does not belong to the current detailed view', () => {
        seedHistory(['/projects/p1/tasks/open', '/projects/p1/goals/g1', '/projects/p1/goals/g1/notes'])

        SharedHelper.onHistoryPop('/projects/p1/goals/g1')

        expect(store.getState().lastVisitedScreen).toEqual([])
        expect(processUrlAsLoggedIn).toHaveBeenCalledWith(expect.anything(), '/projects/p1/tasks/open', true)
    })

    it('stores a new array reference so useSelector subscribers re-render', () => {
        const before = seedHistory(['/projects/p1/tasks/open', '/projects/p1/goals/g1', '/projects/p1/goals/g1/notes'])

        SharedHelper.onHistoryPop('/projects/p1/goals/g1')

        const after = store.getState().lastVisitedScreen
        expect(after).not.toBe(before)
        // The array that was in the store must not have been mutated on the way out either,
        // otherwise a component still holding it would read the popped-down history.
        expect(before).toEqual(['/projects/p1/tasks/open', '/projects/p1/goals/g1', '/projects/p1/goals/g1/notes'])
    })

    it('keeps only the entries above the navigated path', () => {
        seedHistory(['/a', '/b', '/projects/p1/goals/g1', '/projects/p1/goals/g1/notes'])

        SharedHelper.onHistoryPop('/projects/p1/goals/g1')

        expect(store.getState().lastVisitedScreen).toEqual(['/a'])
        expect(processUrlAsLoggedIn).toHaveBeenCalledWith(expect.anything(), '/b', true)
    })

    it('leaves the stored history untouched when there is nothing to navigate back to', () => {
        const before = seedHistory(['/projects/p1/goals/g1'])

        SharedHelper.onHistoryPop('/projects/p1/goals/g1')

        expect(store.getState().lastVisitedScreen).toBe(before)
        expect(store.getState().lastVisitedScreen).toEqual(['/projects/p1/goals/g1'])
        expect(processUrlAsLoggedIn).not.toHaveBeenCalled()
    })

    it('leaves an empty history untouched', () => {
        const before = seedHistory([])

        SharedHelper.onHistoryPop('/projects/p1/goals/g1')

        expect(store.getState().lastVisitedScreen).toBe(before)
        expect(processUrlAsLoggedIn).not.toHaveBeenCalled()
    })

    it('does not throw when the stored history is not an array', () => {
        store.dispatch(setLastVisitedScreen(undefined))

        expect(() => SharedHelper.onHistoryPop('/projects/p1/goals/g1')).not.toThrow()
        expect(processUrlAsLoggedIn).not.toHaveBeenCalled()
    })
})
