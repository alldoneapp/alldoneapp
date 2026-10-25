import store from './store'
import {
    clearAllOpenTasksShowMoreData,
    clearOpenTasksShowMoreDataInProject,
    clearOpenTasksShowMoreDataInWorkstream,
    setOpenTasksShowMoreDataInProject,
} from './actions'
import { TO_ATTEND_TASKS_MY_DAY_TYPE, WORKSTREAM_TASKS_MY_DAY_TYPE } from '../utils/backends/Tasks/myDayTasks'

describe('open task show-more aggregate cleanup', () => {
    beforeEach(() => store.dispatch(clearAllOpenTasksShowMoreData()))
    afterEach(() => store.dispatch(clearAllOpenTasksShowMoreData()))

    it('recomputes global flags when a project listener group unmounts', () => {
        store.dispatch(
            setOpenTasksShowMoreDataInProject('project-1', TO_ATTEND_TASKS_MY_DAY_TYPE, null, false, true, false)
        )
        expect(store.getState().openTasksShowMoreData.hasFutureTasks).toBe(true)

        store.dispatch(clearOpenTasksShowMoreDataInProject('project-1'))

        expect(store.getState().openTasksShowMoreData.hasFutureTasks).toBe(false)
    })

    it('recomputes project and global flags when a workstream listener is removed', () => {
        store.dispatch(
            setOpenTasksShowMoreDataInProject(
                'project-1',
                WORKSTREAM_TASKS_MY_DAY_TYPE,
                'workstream-1',
                true,
                true,
                false
            )
        )
        expect(store.getState().openTasksShowMoreData.hasSomedayTasks).toBe(true)

        store.dispatch(clearOpenTasksShowMoreDataInWorkstream('project-1', 'workstream-1'))

        expect(store.getState().openTasksShowMoreData['project-1'].hasSomedayTasks).toBe(false)
        expect(store.getState().openTasksShowMoreData.hasSomedayTasks).toBe(false)
    })
})
