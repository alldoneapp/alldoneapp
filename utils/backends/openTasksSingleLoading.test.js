import store from '../../redux/store'
import { setTaskListSingleLoading } from '../../redux/actions'
import { updateOpTasks } from './openTasks'

// AT-2337: updateOpTasks now emits its actions as ONE batched array dispatch
// (see utils/redux/dispatchBatch.js). The actions themselves are unchanged, so
// flatten what the store was handed before looking for the one under test.
const dispatchedActions = dispatchSpy => dispatchSpy.mock.calls.flatMap(([payload]) => [payload].flat())

describe('updateOpTasks incremental loading state', () => {
    it('clears the single-row ghost after publishing resolved task data', () => {
        store.dispatch(setTaskListSingleLoading('project-1user-1', true))
        const dispatch = jest.spyOn(store, 'dispatch').mockImplementation(jest.fn())
        const today = ['0', 0, 0, [], [], [], [], [], [], [], []]

        updateOpTasks('project-1', 'project-1user-1', [today], true, null, true)

        expect(dispatchedActions(dispatch)).toContainEqual(setTaskListSingleLoading('project-1user-1', false))
        // The whole publish is one store notification, not one per action.
        expect(dispatch).toHaveBeenCalledTimes(1)
        dispatch.mockRestore()
        store.dispatch(setTaskListSingleLoading('project-1user-1', false))
    })
})
