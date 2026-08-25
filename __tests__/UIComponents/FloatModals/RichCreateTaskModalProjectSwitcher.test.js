import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * PT-4745 — the add-task popup shows the project switcher at EVERY entry point,
 * pre-selected to the project it was opened from.
 *
 * Before this, `showProjectSelector` had to be opted into and only the two All
 * Projects entry points did, so adding a task from a project line, a goal, a
 * note, a contact or a chat gave no way to change the project without closing
 * the popup and starting again somewhere else.
 *
 * Two halves are pinned here, and they fail in opposite directions. The switcher
 * must be THERE by default (a regression hides it silently — the row simply is
 * not rendered, nothing errors), and the project it opened on must be the one it
 * shows (a regression there is worse than a missing switcher, because the task
 * is filed in the wrong project while the popup says otherwise).
 */

const mockCreateTaskWithService = jest.fn()
const mockDispatch = jest.fn()
const mockWatchGoal = jest.fn()

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
        getActiveProjects2: () => [
            { id: 'project-default', name: 'Personal' },
            { id: 'project-work', name: 'Alldone Product' },
        ],
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
    watchGoal: (...args) => mockWatchGoal(...args),
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
        loggedUserProjectsMap: {
            'project-default': { id: 'project-default', name: 'Personal' },
            'project-work': { id: 'project-work', name: 'Alldone Product' },
        },
        loggedUserProjects: [],
        administratorUser: { uid: 'admin' },
        projectUsers: {},
        smallScreenNavigation: false,
    }),
    dispatch: jest.fn(),
}))

import RichCreateTaskModal from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { AUTOMATIC_PROJECT_OPTION } from '../../../components/UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

const baseTask = {
    name: 'Fix the scroll bug',
    extendedName: 'Fix the scroll bug',
    userId: 'user-1',
    userIds: ['user-1'],
    currentReviewerId: 'user-1',
    creatorId: 'user-1',
    observersIds: [],
    dueDate: 1786006363706,
    estimations: {},
    recurrence: 'never',
    parentGoalId: null,
    isPrivate: false,
    isPublicFor: [0],
    description: '',
}

const renderPopup = (props = {}, taskOverrides = {}) => {
    capturedMainModalProps = null
    capturedProjectPickerProps = null
    let tree
    act(() => {
        tree = renderer.create(
            <RichCreateTaskModal
                initialProjectId="project-work"
                initialTask={{ ...baseTask, ...taskOverrides }}
                fromTaskList={true}
                closeModal={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

// What the user does, in the order ProjectListModal does it: open the in-place
// picker, press a row (which commits), then let it close. The close is what
// brings MainModal back, so reading `capturedMainModalProps` before it would
// read the render from before the switch.
const pickProject = async projectId => {
    act(() => {
        capturedMainModalProps.showSelectProject(true)
    })
    act(() => {
        capturedProjectPickerProps.setSelectedProjectId(projectId)
        capturedProjectPickerProps.closePopover()
    })
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
    })
}

describe('RichCreateTaskModal project switcher (PT-4745)', () => {
    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockResolvedValue({ id: 'task-1' })
        mockDispatch.mockClear()
        mockWatchGoal.mockClear()
    })

    // The headline of PT-4745: no caller has to ask for it any more.
    it('shows the switcher without any caller opting in', () => {
        renderPopup()

        // MainModal renders the switcher row only when it has a selectedProject,
        // so this IS "the switcher is on screen".
        expect(capturedMainModalProps.selectedProject).toEqual({
            id: 'project-work',
            name: 'Alldone Product',
        })
    })

    it('pre-selects the project the popup was opened from, in the row and in the picker', () => {
        renderPopup()

        expect(capturedMainModalProps.projectId).toBe('project-work')

        act(() => {
            capturedMainModalProps.showSelectProject(true)
        })
        expect(capturedProjectPickerProps.projectId).toBe('project-work')
    })

    it('creates the task in the project it opened on when nothing is switched', () => {
        renderPopup()

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })

        const [payload] = mockCreateTaskWithService.mock.calls[0]
        expect(payload.projectId).toBe('project-work')
        // A popup opened on a real project is never routed, switcher or not.
        expect(payload.projectRouting).toBeUndefined()
    })

    // Karsten's call on PT-4745: one consistent picker everywhere. "Automatic"
    // stays available from a project line, it is just never pre-selected there.
    it('still offers the Automatic option when a real project is in context', () => {
        renderPopup()

        act(() => {
            capturedMainModalProps.showSelectProject(true)
        })

        expect(capturedProjectPickerProps.showAutomaticProject).toBe(true)
        expect(capturedProjectPickerProps.projectId).not.toBe(AUTOMATIC_PROJECT_OPTION)
    })

    it('switches the project the task is created in', async () => {
        renderPopup()

        await pickProject('project-default')

        expect(capturedMainModalProps.selectedProject).toEqual({
            id: 'project-default',
            name: 'Personal',
        })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })
        expect(mockCreateTaskWithService.mock.calls[0][0].projectId).toBe('project-default')
    })

    it('keeps the switcher when the popup opens on a project it cannot resolve', () => {
        // Hiding the row on an unresolvable id is exactly the failure PT-4745
        // removes: it leaves the popup with no way out of the wrong project.
        renderPopup({ initialProjectId: 'project-unknown' })

        expect(capturedMainModalProps.selectedProject).toEqual({ id: 'project-unknown' })
    })

    it('can still be switched off explicitly', () => {
        renderPopup({ showProjectSelector: false })

        expect(capturedMainModalProps.selectedProject).toBeNull()
    })

    describe('a draft that changes project cannot keep another project’s ids', () => {
        it('drops the parent goal', async () => {
            renderPopup({}, { parentGoalId: 'goal-1', parentGoalIsPublicFor: ['user-1'], lockKey: 'lock-1' })

            await pickProject('project-default')

            act(() => {
                capturedMainModalProps.createTask(jest.fn())
            })
            const [payload] = mockCreateTaskWithService.mock.calls[0]
            expect(payload.parentGoalId).toBeNull()
            expect(payload.lockKey).toBe('')
        })

        it('hands a colleague-assigned draft back to the logged user', async () => {
            renderPopup(
                {},
                {
                    userId: 'colleague',
                    userIds: ['colleague'],
                    currentReviewerId: 'colleague',
                    observersIds: ['colleague'],
                }
            )

            await pickProject('project-default')

            act(() => {
                capturedMainModalProps.createTask(jest.fn())
            })
            const [payload] = mockCreateTaskWithService.mock.calls[0]
            expect(payload.userId).toBe('user-1')
            expect(payload.currentReviewerId).toBe('user-1')
            expect(payload.observersIds).toEqual([])
        })

        it('leaves the draft alone when the same project is picked again', async () => {
            renderPopup({}, { parentGoalId: 'goal-1' })

            await pickProject('project-work')

            act(() => {
                capturedMainModalProps.createTask(jest.fn())
            })
            // Re-picking what is already selected is a no-op, not a reset — the
            // user did not ask to lose their goal.
            expect(mockCreateTaskWithService.mock.calls[0][0].parentGoalId).toBe('goal-1')
        })

        it('drops it for the Automatic option too, which is a different host project', async () => {
            renderPopup({}, { parentGoalId: 'goal-1' })

            await pickProject(AUTOMATIC_PROJECT_OPTION)

            act(() => {
                capturedMainModalProps.createTask(jest.fn())
            })
            const [payload] = mockCreateTaskWithService.mock.calls[0]
            expect(payload.parentGoalId).toBeNull()
            expect(payload.projectId).toBe('project-default')
            expect(payload.projectRouting).toMatchObject({ status: 'pending' })
        })

        it('drops it when Automatic resolves to the very project the popup opened on', async () => {
            // The host project id does not move here, so an id-only comparison
            // reads this as "nothing changed" — but the server is now free to
            // re-home the task, which is exactly what makes a goal link from the
            // ORIGINAL project unsafe to keep.
            renderPopup({ initialProjectId: 'project-default' }, { parentGoalId: 'goal-1' })

            await pickProject(AUTOMATIC_PROJECT_OPTION)

            act(() => {
                capturedMainModalProps.createTask(jest.fn())
            })
            const [payload] = mockCreateTaskWithService.mock.calls[0]
            expect(payload.parentGoalId).toBeNull()
            expect(payload.projectRouting).toMatchObject({ status: 'pending' })
        })
    })
})
