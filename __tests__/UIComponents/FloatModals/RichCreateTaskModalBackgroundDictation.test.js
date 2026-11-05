import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * PT-5424 — a hold on the task board's floating "+" closes the add-task popup the moment it is
 * released, and the take is transcribed after that. The popup therefore hands the dictated text's
 * fate to the push-to-talk handoff (`setBackgroundSubmit`): the task must be created from the
 * popup's draft exactly as Enter would — same project, same Automatic routing — even though the
 * popup is long unmounted, and a failure must be reported rather than lost with the popup.
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
import { createPushToTalkHandoff } from '../../../components/UIControls/pushToTalkHandoff'

const EMPTY_DRAFT = {
    name: '',
    extendedName: '',
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
}

const closeModal = jest.fn()

const openByHold = (initialProjectId = AUTOMATIC_PROJECT_OPTION) => {
    const handoff = createPushToTalkHandoff({ origin: { clientX: 1, clientY: 1 } })
    let tree
    act(() => {
        tree = renderer.create(
            <RichCreateTaskModal
                initialProjectId={initialProjectId}
                initialTask={EMPTY_DRAFT}
                fromTaskList={true}
                closeModal={closeModal}
                pushToTalkHandoff={handoff}
            />
        )
    })
    // The opener closes the popup on release, before the transcript exists.
    act(() => tree.unmount())
    return handoff
}

describe('RichCreateTaskModal background dictation (PT-5424)', () => {
    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockResolvedValue({ id: 'task-1' })
        closeModal.mockClear()
    })

    it('creates the dictated task after the popup is gone, routed like "Automatic"', async () => {
        const submit = openByHold().getBackgroundSubmit()
        expect(typeof submit).toBe('function')

        await act(async () => {
            await submit('  Buy\n milk  ')
        })

        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
        const [payload] = mockCreateTaskWithService.mock.calls[0]
        expect(payload.name).toBe('Buy milk')
        expect(payload.extendedName).toBe('Buy milk')
        expect(payload.projectId).toBe('project-default')
        expect(payload.projectRouting).toEqual(expect.objectContaining({ hostProjectId: 'project-default' }))
        // Closing is the opener's job and has already happened.
        expect(closeModal).not.toHaveBeenCalled()
    })

    it('creates it in the open project when the hold started inside one', async () => {
        const submit = openByHold('project-work').getBackgroundSubmit()

        await act(async () => {
            await submit('Call Anna')
        })

        const [payload] = mockCreateTaskWithService.mock.calls[0]
        expect(payload.projectId).toBe('project-work')
        expect(payload.projectRouting).toBeUndefined()
    })

    it('creates nothing from an empty transcript', async () => {
        const submit = openByHold().getBackgroundSubmit()

        await act(async () => {
            await submit('   ')
        })

        expect(mockCreateTaskWithService).not.toHaveBeenCalled()
    })

    it('reports a failed creation instead of losing it with the closed popup', async () => {
        mockCreateTaskWithService.mockRejectedValue(new Error('offline write failed'))
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const submit = openByHold().getBackgroundSubmit()

        await act(async () => {
            await submit('Buy milk')
        })

        expect(alertSpy).toHaveBeenCalledWith('Task could not be created')
        alertSpy.mockRestore()
        errorSpy.mockRestore()
    })

    it('registers nothing for a popup that was not opened by a hold', () => {
        const handoff = createPushToTalkHandoff()
        expect(handoff.getBackgroundSubmit()).toBeNull()
    })
})
