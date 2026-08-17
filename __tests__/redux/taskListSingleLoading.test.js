import { setTaskListSingleLoading } from '../../redux/actions'
import { initialState, theReducer } from '../../redux/store'

describe('single task-list loading state', () => {
    it('tracks loading independently for each task-list instance', () => {
        let state = theReducer(initialState, setTaskListSingleLoading('project-1-user-1', true))
        state = theReducer(state, setTaskListSingleLoading('project-2-user-1', true))

        expect(state.taskListSingleLoading).toEqual({
            'project-1-user-1': true,
            'project-2-user-1': true,
        })

        state = theReducer(state, setTaskListSingleLoading('project-1-user-1', false))

        expect(state.taskListSingleLoading).toEqual({ 'project-2-user-1': true })
    })
})
