/**
 * @jest-environment jsdom
 */

// AT-2906: a task assigned to somebody who has since left the project (or whose account was
// deleted) used to bounce its detail route to "All projects" without a word — from an Anna activity
// row that read as "the click opened the wrong thing". The task exists and is readable, so it opens
// in the logged user's context, as notes already do (AT-2356).

import { seedLoggedUser, seedProjects } from '../../../testUtils/seedStore'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import Backend from '../../../utils/BackendBridge'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'
import { DV_TAB_TASK_PROPERTIES } from '../../../utils/TabNavigationConstants'

const PROJECT_ID = 'seeded-project-0'
const LOGGED_USER_ID = 'u-logged'

describe('AT-2906 - opening a task whose assignee is gone', () => {
    let navigation

    beforeEach(() => {
        jest.restoreAllMocks()
        navigation = { navigate: jest.fn() }
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID }]),
            seedLoggedUser({ uid: LOGGED_USER_ID, projectIds: [PROJECT_ID] }),
            storeCurrentUser({ uid: LOGGED_USER_ID }),
        ])
        jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)
    })

    it('opens the task with the logged user as context', async () => {
        jest.spyOn(Backend, 'getTaskData').mockResolvedValue({ id: 't1', userId: 'former-member', name: 'Ship' })
        await TasksHelper.processURLTaskDetailsTab(navigation, DV_TAB_TASK_PROPERTIES, PROJECT_ID, 't1')
        expect(navigation.navigate).toHaveBeenCalledWith(
            'TaskDetailedView',
            expect.objectContaining({ projectId: PROJECT_ID, task: expect.objectContaining({ id: 't1' }) })
        )
        expect(store.getState().currentUser.uid).toBe(LOGGED_USER_ID)
    })

    it('still leaves a task that does not exist', async () => {
        jest.spyOn(Backend, 'getTaskData').mockResolvedValue(null)
        await TasksHelper.processURLTaskDetailsTab(navigation, DV_TAB_TASK_PROPERTIES, PROJECT_ID, 'gone')
        expect(navigation.navigate).not.toHaveBeenCalledWith('TaskDetailedView', expect.anything())
    })
})
