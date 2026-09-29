/**
 * @jest-environment jsdom
 */

import { getProjectData, getTaskData, loginWithGoogleWebAnonymously } from '../../utils/backends/firestore'
import { getUserData } from '../../utils/backends/Users/usersFirestore'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { storeCurrentUser } from '../../redux/actions'
import { seedLoggedUser, seedProjects } from '../../testUtils/seedStore'
import { DV_TAB_TASK_CHAT } from '../../utils/TabNavigationConstants'

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
    getTaskData: jest.fn(),
    getProjectData: jest.fn(),
    loginWithGoogleWebAnonymously: jest.fn(),
}))

jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Users/usersFirestore'),
    getUserData: jest.fn(),
}))

const PROJECT_ID = '-Ona1ph4uu0mdSl9zizI'
const TASK_ID = '-P2gR4AY7lc18Yne8be7'
const TASK_PATH = `/projects/${PROJECT_ID}/tasks/${TASK_ID}/chat`
const task = {
    id: TASK_ID,
    userId: 'task-assignee',
    creatorId: 'task-creator',
    isPublicFor: [0],
    parentId: null,
}

describe('public task chat URL routing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        loginWithGoogleWebAnonymously.mockResolvedValue()
        getTaskData.mockResolvedValue(task)
        getProjectData.mockResolvedValue({ id: PROJECT_ID, creatorId: 'project-creator', isShared: 0 })
    })

    it('authorizes a public task without reading its creator private profile', async () => {
        const onIsShared = jest.fn()
        const onNotShared = jest.fn()

        expect(SharedHelper.matchesSharedResourceUrl(TASK_PATH)).toBe(true)
        await SharedHelper.processUrl(false, TASK_PATH, jest.fn(), onIsShared, onNotShared, jest.fn(), jest.fn())

        expect(loginWithGoogleWebAnonymously).toHaveBeenCalledTimes(1)
        expect(getTaskData).toHaveBeenCalledWith(PROJECT_ID, TASK_ID)
        expect(getUserData).not.toHaveBeenCalled()
        expect(onIsShared).toHaveBeenCalledWith(
            TASK_PATH,
            {
                projectUser: expect.objectContaining({ uid: task.creatorId }),
                currentUser: expect.objectContaining({ uid: task.creatorId }),
            },
            expect.objectContaining({ projectId: PROJECT_ID, taskId: TASK_ID }),
            `/projects/${PROJECT_ID}/tasks/${TASK_ID}`
        )
        expect(onNotShared).not.toHaveBeenCalled()
    })

    it('rejects a task that is not public', async () => {
        getTaskData.mockResolvedValue({ ...task, isPublicFor: ['task-creator'] })
        const onIsShared = jest.fn()
        const onNotShared = jest.fn()

        await SharedHelper.processUrl(false, TASK_PATH, jest.fn(), onIsShared, onNotShared, jest.fn(), jest.fn())

        expect(onIsShared).not.toHaveBeenCalled()
        expect(onNotShared).toHaveBeenCalledTimes(1)
        expect(getUserData).not.toHaveBeenCalled()
    })

    it('opens the chat tab without reading its assignee private profile', async () => {
        const navigation = { navigate: jest.fn() }
        const assigneeLookup = jest.spyOn(Backend, 'getUserOrContactBy')
        jest.spyOn(Backend, 'getTaskData').mockResolvedValue(task)
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID, isShared: 0 }]),
            seedLoggedUser({ uid: task.creatorId, projectIds: [PROJECT_ID], isAnonymous: true }),
            storeCurrentUser({ uid: task.creatorId }),
        ])

        await TasksHelper.processURLTaskDetailsTab(navigation, DV_TAB_TASK_CHAT, PROJECT_ID, TASK_ID)

        expect(assigneeLookup).not.toHaveBeenCalled()
        expect(navigation.navigate).toHaveBeenCalledWith(
            'TaskDetailedView',
            expect.objectContaining({ task, projectId: PROJECT_ID })
        )
        expect(store.getState().currentUser).toEqual(
            expect.objectContaining({ uid: task.userId, displayName: 'Shared user' })
        )
    })
})
