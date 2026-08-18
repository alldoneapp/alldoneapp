import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2306 — the "Automatic" project option of the add-task popup.
 *
 * "Automatic" is not a project: a task's project is its Firestore path, so the
 * popup has to create the task in a real host project (the user's default) and
 * ask the server to re-home it with a `projectRouting` stamp. These tests pin
 * both halves, because dropping either one fails silently — no stamp means the
 * task quietly stays in the default project forever, and a stamp on a task whose
 * project the user picked by hand would move it out from under them.
 */

const mockCreateTaskWithService = jest.fn()
const mockDispatch = jest.fn()

let capturedMainModalProps = null
let capturedProjectPickerProps = null

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: () => false,
}))

jest.mock('../../../utils/backends/Tasks/TaskServiceFrontendHelper', () => ({
    createTaskWithService: (...args) => mockCreateTaskWithService(...args),
}))

jest.mock('../../../components/UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/MainModal', () => props => {
    capturedMainModalProps = props
    return null
})
jest.mock('../../../components/UIComponents/FloatModals/RecurrenceModal', () => 'RecurrenceModal')
jest.mock('../../../components/UIComponents/FloatModals/DueDateModal/DueDateModal', () => 'DueDateModal')
jest.mock('../../../components/UIComponents/FloatModals/PrivacyModal/PrivacyModal', () => 'PrivacyModal')
jest.mock(
    '../../../components/UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal',
    () => 'AssigneeAndObserversModal'
)
jest.mock(
    '../../../components/UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal',
    () => 'TaskParentGoalModal'
)
jest.mock(
    '../../../components/UIComponents/FloatModals/TaskMoreOptionsModal/TaskMoreOptionModal',
    () => 'TaskMoreOptionModal'
)
jest.mock('../../../components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch', () => props => {
    capturedProjectPickerProps = props
    return null
})

jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getNewDefaultTask: () => ({ name: '', extendedName: '', observersIds: [] }),
        getTaskNameWithoutMeta: name => name,
    },
    OPEN_STEP: 'open',
    objectIsPublicForLoggedUser: () => true,
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getProjectById: () => ({ index: 0 }),
        getTypeOfProject: () => 'active',
        getActiveProjects2: () => [{ id: 'project-default' }, { id: 'project-work' }],
        getGuideProjects: () => [],
        sortProjects: projects => projects,
    },
    checkIfSelectedProject: () => true,
}))
jest.mock('../../../components/MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    addProjectDataToMyDayData: jest.fn(),
    processMyDayData: () => ({ myDayOtherTasks: [] }),
}))
jest.mock('../../../utils/LinkingHelper', () => ({ getDvTabLink: () => '' }))
jest.mock('../../../utils/backends/openTasks', () => ({
    DATE_TASK_INDEX: 0,
    EMPTY_SECTION_INDEX: 1,
    MAIN_TASK_INDEX: 2,
    NOT_PARENT_GOAL_INDEX: 'noGoal',
    TODAY_DATE: 'today',
}))
jest.mock('../../../utils/backends/Tasks/myDayTasks', () => ({
    TO_ATTEND_TASKS_MY_DAY_TYPE: 'toAttend',
    WORKSTREAM_TASKS_MY_DAY_TYPE: 'workstream',
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hideFloatPopup' }),
    showFloatPopup: () => ({ type: 'showFloatPopup' }),
    setSelectedSidebarTab: () => ({ type: 'setSelectedSidebarTab' }),
    setSelectedTypeOfProject: () => ({ type: 'setSelectedTypeOfProject' }),
    setTasksArrowButtonIsExpanded: () => ({ type: 'setTasksArrowButtonIsExpanded' }),
    switchProject: () => ({ type: 'switchProject' }),
    updateTaskSuggestedCommentModalData: () => ({ type: 'updateTaskSuggestedCommentModalData' }),
    hideWebSideBar: () => ({ type: 'hideWebSideBar' }),
}))
jest.mock('../../../components/Workstreams/WorkstreamHelper', () => ({
    isWorkstream: id => String(id).startsWith('WS_'),
    WORKSTREAM_ID_PREFIX: 'WS_',
}))
jest.mock('../../../utils/BackendBridge', () => ({
    watchGoal: jest.fn(),
    unwatch: jest.fn(),
    setLinkedParentObjects: jest.fn(),
}))
jest.mock('../../../redux/store', () => ({
    getState: () => ({
        loggedUser: {
            uid: 'user-1',
            templateProjectIds: [],
            numberTodayTasks: 0,
            defaultProjectId: 'project-default',
        },
        currentUser: { uid: 'user-1' },
        selectedNavItem: '',
        selectedProjectIndex: 0,
        filteredOpenTasksStore: {},
        myDayAllTodayTasks: {},
        loggedUserProjectsMap: { 'project-default': { id: 'project-default', name: 'Personal' } },
        loggedUserProjects: [],
        administratorUser: { uid: 'admin' },
        projectUsers: {},
        smallScreenNavigation: false,
    }),
    dispatch: jest.fn(),
}))

import RichCreateTaskModal from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { AUTOMATIC_PROJECT_OPTION } from '../../../components/UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

const renderPopup = (props = {}) => {
    capturedMainModalProps = null
    capturedProjectPickerProps = null
    let tree
    act(() => {
        tree = renderer.create(
            <RichCreateTaskModal
                initialProjectId={AUTOMATIC_PROJECT_OPTION}
                initialTask={{
                    name: 'Fix the scroll bug',
                    extendedName: 'Fix the scroll bug',
                    userId: 'user-1',
                    userIds: ['user-1'],
                    currentReviewerId: 'user-1',
                    observersIds: [],
                    dueDate: 1786006363706,
                    estimations: {},
                    recurrence: 'never',
                    parentGoalId: null,
                    isPrivate: false,
                    description: '',
                }}
                fromTaskList={true}
                showProjectSelector={true}
                closeModal={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

describe('RichCreateTaskModal with the Automatic project option', () => {
    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockResolvedValue({ id: 'task-1' })
        mockDispatch.mockClear()
    })

    it('creates the task in the default project and asks the server to route it', () => {
        renderPopup()

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        const [payload] = mockCreateTaskWithService.mock.calls[0]
        // The sentinel must never reach the backend as a project id.
        expect(payload.projectId).toBe('project-default')
        expect(payload.projectRouting).toEqual({
            status: 'pending',
            source: 'automatic_project_option',
            hostProjectId: 'project-default',
            requestedAt: expect.any(Number),
        })
    })

    it('shows Automatic as the selected option in the popup and its picker', () => {
        renderPopup()

        expect(capturedMainModalProps.selectedProject).toEqual({ id: AUTOMATIC_PROJECT_OPTION })
        // MainModal only renders the project row when it has a selected project,
        // so an unrecognised sentinel here would hide the picker entirely.
        expect(capturedMainModalProps.projectId).toBe('project-default')

        act(() => {
            capturedMainModalProps.showSelectProject(true)
        })
        expect(capturedProjectPickerProps.projectId).toBe(AUTOMATIC_PROJECT_OPTION)
        expect(capturedProjectPickerProps.showAutomaticProject).toBe(true)
    })

    it('stops routing the task once the user picks a project by hand', async () => {
        renderPopup()

        act(() => {
            capturedMainModalProps.showSelectProject(true)
        })
        // What ProjectListModal does on a row press: commit, then close.
        act(() => {
            capturedProjectPickerProps.setSelectedProjectId('project-work')
            capturedProjectPickerProps.closePopover()
        })
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0))
        })
        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        const [payload] = mockCreateTaskWithService.mock.calls[0]
        expect(payload.projectId).toBe('project-work')
        expect(payload.projectRouting).toBeUndefined()
    })

    it('adds no routing stamp when the popup opened on a real project', () => {
        renderPopup({ initialProjectId: 'project-work' })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        const [payload] = mockCreateTaskWithService.mock.calls[0]
        expect(payload.projectId).toBe('project-work')
        expect(payload.projectRouting).toBeUndefined()
    })
})
