import React from 'react'
import renderer, { act } from 'react-test-renderer'

// AT-2183: a single intended submission of the "Add task" popup must create
// exactly one task, no matter how many Enter triggers fire for it.

const mockCreateTaskWithService = jest.fn()
const mockDispatch = jest.fn()

let capturedMainModalProps = null

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

// The popup lazily renders these only when their sub modal is open.
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
jest.mock(
    '../../../components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch',
    () => 'SelectProjectModalInSearch'
)

// Keep the popup's helper modules out of the test: they reach the Firebase
// layer, which needs build time environment variables.
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
        getActiveProjects2: () => [],
        getGuideProjects: () => [],
        sortProjects: () => [],
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
        loggedUser: { uid: 'user-1', templateProjectIds: [], numberTodayTasks: 0 },
        currentUser: { uid: 'user-1' },
        selectedNavItem: '',
        selectedProjectIndex: 0,
        filteredOpenTasksStore: {},
        myDayAllTodayTasks: {},
        loggedUserProjectsMap: {},
        loggedUserProjects: [],
        administratorUser: { uid: 'admin' },
        projectUsers: {},
        smallScreenNavigation: false,
    }),
    dispatch: jest.fn(),
}))

import RichCreateTaskModal from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'

const renderPopup = (props = {}) => {
    capturedMainModalProps = null
    let tree
    act(() => {
        tree = renderer.create(
            <RichCreateTaskModal
                initialProjectId="project-1"
                initialTask={{
                    name: 'Buy milk',
                    extendedName: 'Buy milk',
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
                closeModal={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

describe('RichCreateTaskModal duplicate submissions (AT-2183)', () => {
    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockImplementation(() => new Promise(() => {}))
        mockDispatch.mockClear()
    })

    test('creates a single task when Return is pressed twice in a row', () => {
        renderPopup()
        const { createTask } = capturedMainModalProps
        const trySetLinkedObjects = jest.fn()

        act(() => {
            // Two quick Returns, or one Return reaching several listeners.
            createTask(trySetLinkedObjects)
            createTask(trySetLinkedObjects)
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
    })

    test('creates a single task for a burst of five submissions', () => {
        renderPopup()
        const { createTask } = capturedMainModalProps

        act(() => {
            for (let i = 0; i < 5; i++) createTask(jest.fn())
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
    })

    test('does not create a task, or spend the submission, when the name is empty', () => {
        renderPopup({ initialTask: { name: '   ', extendedName: '   ', userId: 'user-1', observersIds: [] } })
        const { createTask } = capturedMainModalProps

        act(() => {
            createTask(jest.fn())
        })

        expect(mockCreateTaskWithService).not.toHaveBeenCalled()
    })

    test('closes the popup only once for a repeated submission', () => {
        const closeModal = jest.fn()
        renderPopup({ closeModal })
        const { createTask } = capturedMainModalProps

        act(() => {
            createTask(jest.fn())
            createTask(jest.fn())
        })

        expect(closeModal).toHaveBeenCalledTimes(1)
    })

    test('a second popup instance can still create the next task', () => {
        renderPopup()
        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        renderPopup({ initialTask: { name: 'Second task', extendedName: 'Second task', observersIds: [] } })
        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(2)
    })
})
