import React from 'react'
import renderer, { act } from 'react-test-renderer'

// DueDateModal invokes saveDueDateBeforeSaveTask as (task, date, isObserved) since
// 6558232a2, but this popup's handler kept the old (date) signature — so picking a
// reminder date stored the WHOLE draft task object under dueDate. Firestore and
// Algolia accepted it silently; the Typesense backfill's typed schema surfaced two
// production tasks corrupted this way. This suite pins the corrected contract.

const mockCreateTaskWithService = jest.fn()
const mockDispatch = jest.fn()

let capturedMainModalProps = null
let capturedDueDateModalProps = null

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
jest.mock('../../../components/UIComponents/FloatModals/DueDateModal/DueDateModal', () => props => {
    capturedDueDateModalProps = props
    return null
})

// The popup lazily renders these only when their sub modal is open.
jest.mock('../../../components/UIComponents/FloatModals/RecurrenceModal', () => 'RecurrenceModal')
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

const INITIAL_DUE_DATE = 1786006363706

const renderPopup = (props = {}) => {
    capturedMainModalProps = null
    capturedDueDateModalProps = null
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
                    dueDate: INITIAL_DUE_DATE,
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

describe('RichCreateTaskModal reminder selection (dueDate object corruption)', () => {
    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockImplementation(() => new Promise(() => {}))
        mockDispatch.mockClear()
    })

    test('a picked date is persisted as the timestamp, never as the draft task object', () => {
        renderPopup()
        act(() => {
            capturedMainModalProps.showDueDate()
        })

        const { task: draftTask, saveDueDateBeforeSaveTask } = capturedDueDateModalProps
        const pickedDate = INITIAL_DUE_DATE + 86400000

        act(() => {
            // Exactly how DueDateModal invokes the callback: (task, date, isObserved).
            saveDueDateBeforeSaveTask(draftTask, pickedDate, false)
        })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
        const params = mockCreateTaskWithService.mock.calls[0][0]
        expect(params.dueDate).toBe(pickedDate)
        expect(typeof params.dueDate).toBe('number')
    })

    test('dismissing the reminder modal without a date keeps the existing dueDate', () => {
        renderPopup()
        act(() => {
            capturedMainModalProps.showDueDate()
        })

        const { task: draftTask, saveDueDateBeforeSaveTask } = capturedDueDateModalProps
        act(() => {
            saveDueDateBeforeSaveTask(draftTask, undefined, false)
        })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
        expect(mockCreateTaskWithService.mock.calls[0][0].dueDate).toBe(INITIAL_DUE_DATE)
    })
})
