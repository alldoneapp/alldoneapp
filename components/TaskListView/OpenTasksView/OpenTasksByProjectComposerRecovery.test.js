import React from 'react'
import renderer, { act } from 'react-test-renderer'
import OpenTasksByProject from './OpenTasksByProject'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

// Selector subscriptions cause real Redux updates to bypass React.memo. Drive the underlying
// component here because the selector double reads state directly without subscribing.
const Project = OpenTasksByProject.type

let mockState
let mockEditing = false
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../../utils/editingGuard', () => ({ useIsUserEditing: () => mockEditing }))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: jest.fn(() => true) },
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    AMOUNT_TASKS_INDEX: 1,
    DATE_TASK_INDEX: 0,
    TODAY_DATE: '0',
    watchAllGoals: jest.fn(),
    watchAllMilestones: jest.fn(),
}))
jest.mock('../../../utils/BackendBridge', () => ({ __esModule: true, default: { unwatch: jest.fn() } }))
jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({ watchProjectOKRs: jest.fn() }))
jest.mock('../../../utils/assistantSchedule', () => ({ buildAssistantProfileTimelineDates: () => [] }))
jest.mock('../OKRs/okrHelper', () => ({ getOkrAllProjectsTodayKey: () => 'today', getOkrUserTimezone: () => 'UTC' }))
jest.mock('../../MyDayView/AssistantLine/useAssistantLineSwitch', () => ({
    useProjectAssistantLine: () => ({ hasAssistantLine: true, assistantLineProps: {} }),
}))
jest.mock('./useTaskCompletionProjectExit', () => ({
    __esModule: true,
    default: () => ({ exitRunId: 0, holdProjectLine: false }),
}))
jest.mock('../ProjectSection', () => ({
    __esModule: true,
    default: 'ProjectSection',
    ProjectSectionBody: 'ProjectSectionBody',
}))
jest.mock('../Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('./OpenTasksByDate', () => 'OpenTasksByDate')
jest.mock('./NeedShowMoreOpenTasksButton', () => 'NeedShowMoreOpenTasksButton')
jest.mock('./OpenTasksByProjectHandler', () => 'OpenTasksByProjectHandler')
jest.mock('./BottomShowMoreButtonContainer', () => 'BottomShowMoreButtonContainer')
jest.mock('../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../OKRs/OKRSection', () => 'OKRSection')
jest.mock('../Header/UpcomingMilestoneRow', () => 'UpcomingMilestoneRow')
jest.mock('../PriorityFilters/TaskFiltersLine', () => 'TaskFiltersLine')
jest.mock('./OpenTaskViewForAssistants/AssistantScheduleTimeline', () => 'AssistantScheduleDateSection')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('./NewTaskSection', () => 'NewTaskSection')

describe('selected project composer without published task dates (AT-2672)', () => {
    const instance = 'project-1user-1'
    let tree
    const render = async props => {
        await act(async () => {
            tree = renderer.create(<Project projectId="project-1" {...props} />)
        })
    }
    beforeEach(() => {
        mockEditing = false
        SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
        mockState = {
            loggedUserProjectsMap: { 'project-1': { id: 'project-1', index: 0 } },
            selectedProjectIndex: 0,
            currentUser: { uid: 'user-1' },
            loggedUser: { uid: 'user-1', projectIds: ['project-1'], templateProjectIds: [] },
            okrsByProjectInTasks: {},
            filteredOpenTasksStore: {},
            taskPriorityFilters: [],
            taskVmStateFilters: [],
            initialLoadingEndOpenTasks: { [instance]: true },
            initialLoadingEndObservedTasks: { [instance]: true },
            thereAreNotTasksInFirstDay: {},
        }
    })
    afterEach(() => {
        act(() => tree?.unmount())
        tree = null
    })

    it.each([undefined, []])('keeps the inline composer for a settled view with dates %s', async dates => {
        mockState.filteredOpenTasksStore[instance] = dates
        await render()
        const composer = tree.root.findByType('NewTaskSection')
        expect(composer.props).toMatchObject({ projectId: 'project-1', instanceKey: instance, dateIndex: 0 })
        expect(tree.root.findAllByType('AssistantLine')).toHaveLength(1)
        expect(tree.root.findAllByType('UpcomingMilestoneRow')).toHaveLength(1)
    })

    it('keeps an opened fallback editor mounted until typing finishes', async () => {
        await render()
        mockEditing = true
        mockState.filteredOpenTasksStore[instance] = [['0', 1]]
        await act(async () => tree.update(<Project projectId="project-1" />))
        expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(1)
        expect(tree.root.findAllByType('OpenTasksByDate')).toHaveLength(1)
        mockEditing = false
        await act(async () => tree.update(<Project projectId="project-1" />))
        expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(0)
    })

    it.each([
        'initial-loading',
        'single-loading',
        'access-denied',
        'template',
        'assistant',
        'assistant-profile',
        'all-projects',
    ])('preserves the composer restriction for %s', async mode => {
        if (mode === 'initial-loading') mockState.initialLoadingEndOpenTasks[instance] = false
        if (mode === 'single-loading') mockState.taskListSingleLoading = { [instance]: true }
        if (mode === 'access-denied') SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(false)
        if (mode === 'template') mockState.loggedUser.templateProjectIds = ['project-1']
        if (mode === 'assistant') mockState.currentUser.temperature = 0.7
        if (mode === 'all-projects') mockState.selectedProjectIndex = -1
        await render({ assistantProfileMode: mode === 'assistant-profile' })
        expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(0)
    })

    it('keeps another member’s guide board read only for a normal guide user', async () => {
        mockState.currentUser.uid = 'other-user'
        mockState.initialLoadingEndOpenTasks['project-1other-user'] = true
        mockState.initialLoadingEndObservedTasks['project-1other-user'] = true
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(true)
        await render()
        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(0)
        expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(0)
    })
})
