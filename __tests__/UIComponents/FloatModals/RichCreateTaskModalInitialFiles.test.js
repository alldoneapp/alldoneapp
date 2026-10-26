import React from 'react'
import renderer, { act } from 'react-test-renderer'

// AT-2875: a file dropped on the inline "Add new task" line opens this popup with the file
// attached (`initialFiles`), in the line's date (`initialDueDate`) and with the inline draft
// title. These pin how the popup consumes that hand-over: once, through the SAME draft
// attachment path as a drop on the popup, and without ever creating or uploading on its own.

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
        getNewDefaultTask: () => ({ name: '', extendedName: '', description: '', observersIds: [], dueDate: 1000 }),
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

const mockCheckIsLimitedByTraffic = jest.fn(() => false)
jest.mock('../../../components/Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: (...args) => mockCheckIsLimitedByTraffic(...args),
}))

const mockResolveDraftAttachments = jest.fn()
jest.mock('../../../components/TaskListView/TaskItem/TaskPresentation/taskFileDropHelper', () => ({
    createDraftAttachmentTokens: files => ({
        tokens: files.map(file => `NEWTOKEN(blob:${file.name})`),
        uris: files.map(file => `blob:${file.name}`),
    }),
    appendTokensToDescription: (description, tokens) =>
        description ? `${description}\n ${tokens.join(' ')}` : tokens.join(' '),
    hasDraftAttachments: description => description.includes('NEWTOKEN'),
    resolveDraftAttachments: (...args) => mockResolveDraftAttachments(...args),
}))

jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

import { FEED_GOAL_OBJECT_TYPE } from '../../../components/Feeds/Utils/FeedsConstants'
import RichCreateTaskModal from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const renderPopup = (props = {}) => {
    capturedMainModalProps = null
    let tree
    act(() => {
        tree = renderer.create(
            <RichCreateTaskModal initialProjectId="project-1" fromTaskList={true} closeModal={jest.fn()} {...props} />
        )
    })
    return tree
}

describe('RichCreateTaskModal initial files from the inline add-task line (AT-2875)', () => {
    beforeAll(() => {
        global.URL.revokeObjectURL = jest.fn()
        global.alert = jest.fn()
    })

    beforeEach(() => {
        mockCreateTaskWithService.mockReset()
        mockCreateTaskWithService.mockImplementation(() => new Promise(() => {}))
        mockCheckIsLimitedByTraffic.mockClear()
        mockResolveDraftAttachments.mockReset()
        global.alert.mockClear()
    })

    test('adds the dropped files to the draft description once, with the inline title', () => {
        const tree = renderPopup({
            initialTaskName: 'Review contract',
            initialFiles: [{ name: 'contract.pdf' }, { name: 'photo.png' }],
        })

        expect(capturedMainModalProps.task).toMatchObject({
            name: 'Review contract',
            extendedName: 'Review contract',
            description: 'NEWTOKEN(blob:contract.pdf) NEWTOKEN(blob:photo.png)',
        })
        // The opener already checked the quota; a second check would show the limit modal twice.
        expect(mockCheckIsLimitedByTraffic).not.toHaveBeenCalled()

        // A re-render with the same props must not append the files again.
        act(() => {
            tree.update(
                <RichCreateTaskModal
                    initialProjectId="project-1"
                    fromTaskList={true}
                    closeModal={jest.fn()}
                    initialTaskName="Review contract"
                    initialFiles={[{ name: 'contract.pdf' }, { name: 'photo.png' }]}
                />
            )
        })
        expect(capturedMainModalProps.task.description).toBe('NEWTOKEN(blob:contract.pdf) NEWTOKEN(blob:photo.png)')
        // Opening the popup never creates a task or uploads anything.
        expect(mockCreateTaskWithService).not.toHaveBeenCalled()
        expect(mockResolveDraftAttachments).not.toHaveBeenCalled()
    })

    test('a later drop on the popup itself still goes through the quota check and appends', () => {
        renderPopup({ initialFiles: [{ name: 'first.png' }] })

        act(() => capturedMainModalProps.onFilesDropped([{ name: 'second.png' }]))

        expect(mockCheckIsLimitedByTraffic).toHaveBeenCalledWith('project-1')
        expect(capturedMainModalProps.task.description).toBe('NEWTOKEN(blob:first.png)\n NEWTOKEN(blob:second.png)')
    })

    test('without initial files the popup is unchanged', () => {
        renderPopup()
        expect(capturedMainModalProps.task.description).toBe('')
        expect(capturedMainModalProps.task.dueDate).toBe(1000)
    })

    test('starts in the date of the line it was dropped on', () => {
        renderPopup({ initialDueDate: Number.MAX_SAFE_INTEGER })
        expect(capturedMainModalProps.task.dueDate).toBe(Number.MAX_SAFE_INTEGER)
    })

    test("starts in the line's goal", () => {
        renderPopup({ sourceType: FEED_GOAL_OBJECT_TYPE, sourceId: 'goal-1', sourceIsPublicFor: [0], lockKey: 'lock' })
        expect(capturedMainModalProps.task).toMatchObject({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: [0],
            lockKey: 'lock',
        })
    })

    test('reports the submission only after the attachments uploaded, then creates once', async () => {
        const onDraftSubmitted = jest.fn()
        mockResolveDraftAttachments.mockResolvedValue({ description: 'https://stored/file', failedCount: 0 })
        renderPopup({ initialTaskName: 'Task', initialFiles: [{ name: 'a.png' }], onDraftSubmitted })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
            capturedMainModalProps.createTask(jest.fn())
        })
        expect(onDraftSubmitted).not.toHaveBeenCalled()

        await act(async () => {
            await flush()
        })

        expect(mockResolveDraftAttachments).toHaveBeenCalledTimes(1)
        expect(onDraftSubmitted).toHaveBeenCalledTimes(1)
        expect(mockCreateTaskWithService).toHaveBeenCalledTimes(1)
        expect(mockCreateTaskWithService.mock.calls[0][0]).toMatchObject({
            name: 'Task',
            description: 'https://stored/file',
        })
    })

    test('a failed upload keeps the draft (and the inline text) and creates nothing', async () => {
        const onDraftSubmitted = jest.fn()
        mockResolveDraftAttachments.mockResolvedValue({ description: 'NEWTOKEN(blob:a.png)', failedCount: 1 })
        renderPopup({ initialTaskName: 'Task', initialFiles: [{ name: 'a.png' }], onDraftSubmitted })

        act(() => {
            capturedMainModalProps.createTask(jest.fn())
        })
        await act(async () => {
            await flush()
        })

        expect(global.alert).toHaveBeenCalledWith('Task attachment upload failed')
        expect(onDraftSubmitted).not.toHaveBeenCalled()
        expect(mockCreateTaskWithService).not.toHaveBeenCalled()
    })
})
