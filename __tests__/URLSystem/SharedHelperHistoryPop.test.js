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
        window.history.replaceState(null, '', '/')
    })

    it('routes browser Back to the actual URL and trims the close-button stack', () => {
        seedHistory(['/projects/tasks/open', '/projects/p1/notes/n1/editor', '/projects/p1/notes/n1/properties'])
        window.history.replaceState(null, '', '/projects/p1/notes/n1/editor?assistant=1')

        SharedHelper.onHistoryPop(new PopStateEvent('popstate'))

        expect(processUrlAsLoggedIn).toHaveBeenCalledWith(
            expect.anything(),
            '/projects/p1/notes/n1/editor?assistant=1',
            true
        )
        expect(store.getState().lastVisitedScreen).toEqual(['/projects/tasks/open', '/projects/p1/notes/n1/editor'])
    })

    it('routes browser Forward to the selected object rather than going Back again', () => {
        seedHistory(['/projects/tasks/open'])
        window.history.replaceState(null, '', '/projects/p1/notes/n2/editor')

        SharedHelper.onHistoryPop(new PopStateEvent('popstate'))

        expect(processUrlAsLoggedIn).toHaveBeenCalledWith(expect.anything(), '/projects/p1/notes/n2/editor', true)
        expect(store.getState().lastVisitedScreen).toEqual(['/projects/tasks/open', '/projects/p1/notes/n2/editor'])
    })

    it('keeps route filters while excluding layout parameters from the close-button stack', () => {
        seedHistory(['/projects/p1/user/u1/contacts/all?status=active', '/projects/p1/notes/n1/editor'])
        window.history.replaceState(null, '', '/projects/p1/user/u1/contacts/all?status=active&assistant=1')

        SharedHelper.onHistoryPop(new PopStateEvent('popstate'))

        expect(processUrlAsLoggedIn).toHaveBeenCalledWith(
            expect.anything(),
            '/projects/p1/user/u1/contacts/all?status=active&assistant=1',
            true
        )
        expect(store.getState().lastVisitedScreen).toEqual(['/projects/p1/user/u1/contacts/all?status=active'])
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
