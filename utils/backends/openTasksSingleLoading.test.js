import store from '../../redux/store'
import { setTaskListSingleLoading } from '../../redux/actions'
import { updateOpTasks } from './openTasks'

describe('updateOpTasks incremental loading state', () => {
    it('clears the single-row ghost after publishing resolved task data', () => {
        store.dispatch(setTaskListSingleLoading('project-1user-1', true))
        const dispatch = jest.spyOn(store, 'dispatch').mockImplementation(jest.fn())
        const today = ['0', 0, 0, [], [], [], [], [], [], [], []]

        updateOpTasks('project-1', 'project-1user-1', [today], true, null, true)

        expect(dispatch).toHaveBeenCalledWith(setTaskListSingleLoading('project-1user-1', false))
        dispatch.mockRestore()
        store.dispatch(setTaskListSingleLoading('project-1user-1', false))
    })
})
