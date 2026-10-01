import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

import store from '../../../redux/store'
import { setUsersInProject } from '../../../redux/actions'
import { updateOpTasks } from '../../../utils/backends/openTasks'
import { watchProjectUsers } from '../../../utils/backends/Users/usersFirestore'
import { resetProjectDataLoaderForTests } from '../../../utils/InitialLoad/projectDataLoader'
import OpenTasksByProject from './OpenTasksByProject'

// Keep real Redux subscriptions, project visibility, section rendering, the projection/filter
// pipeline and lazy user loader. A small fixture reducer replaces unrelated app bootstrap state;
// task row UI and unrelated project chrome/listeners are stubbed.
jest.mock('../../../redux/store', () => {
    const { createStore } = require('redux')
    const { reduxBatch } = require('@manaflair/redux-batch')
    return {
        __esModule: true,
        default: createStore((state = {}, action) => {
            if (action.type === 'Test fixture') return action.state
            const fields = {
                'Update open tasks': 'openTasksStore',
                'Update filtered open tasks': 'filteredOpenTasksStore',
                'Update thre are not tasks in first day': 'thereAreNotTasksInFirstDay',
                'Update there are hidden not main tasks': 'thereAreHiddenNotMainTasks',
                'Update initial loading end open tasks': 'initialLoadingEndOpenTasks',
                'Update initial loading end observed tasks': 'initialLoadingEndObservedTasks',
            }
            const field = fields[action.type]
            if (field) return { ...state, [field]: { ...state[field], [action.instanceKey]: action[field] } }
            if (action.type === 'Set users in project')
                return { ...state, projectUsers: { ...state.projectUsers, [action.projectId]: action.users } }
            return state
        }, reduxBatch),
    }
})
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    BACKLOG_DATE_STRING: 'Someday',
}))
jest.mock('../../Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'default',
    WORKSTREAM_ID_PREFIX: 'ws_',
}))
jest.mock('../../GoalsView/GoalsHelper', () => ({
    BACKLOG_MILESTONE_ID: 'backlog',
    DYNAMIC_PERCENT: 'dynamic',
    getOwnerId: jest.fn(),
}))
jest.mock('../../HashtagFilters/FilterHelpers/FilterTasks', () => ({ filterOpenTasks: tasks => tasks }))
jest.mock('../../../utils/EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: (projectId, estimation) => estimation,
}))
jest.mock('../OKRs/okrHelper', () => ({
    getOkrAllProjectsTodayKey: () => 'today',
    getOkrUserTimezone: () => 'UTC',
}))
jest.mock('./OpenTasksByProjectHandler', () => () => null)
jest.mock('./OpenTasksByDate', () => {
    const React = require('react')
    const TasksSections = require('./TasksSections').default
    return props => React.createElement(TasksSections, props)
})
jest.mock('./MainSection', () => 'AddTask')
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./GeneralTasksHeader', () => 'GeneralTasksHeader')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('./MentionSection', () => 'MentionSection')
jest.mock('./SuggestedSectionList', () => 'SuggestedSectionList')
jest.mock('./ObservedFromSectionList', () => 'ObservedFromSectionList')
jest.mock('./StreamAndUserTasksSectionList', () => 'StreamAndUserTasksSectionList')
jest.mock('./CalendarSectionContainer', () => 'CalendarSectionContainer')
jest.mock('../Header/WorkflowHeader', () => 'WorkflowHeader')
jest.mock('../Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('./NeedShowMoreOpenTasksButton', () => 'NeedShowMoreOpenTasksButton')
jest.mock('./BottomShowMoreButtonContainer', () => 'BottomShowMoreButtonContainer')
jest.mock('../OKRs/OKRSection', () => 'OKRSection')
jest.mock('../Header/UpcomingMilestoneRow', () => 'UpcomingMilestoneRow')
jest.mock('../PriorityFilters/TaskFiltersLine', () => 'TaskFiltersLine')
jest.mock('../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../../MyDayView/AssistantLine/useAssistantLineSwitch', () => ({
    useProjectAssistantLine: () => ({ hasAssistantLine: false }),
}))
jest.mock('../../../utils/BackendBridge', () => ({ unwatch: jest.fn() }))
jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({ watchProjectOKRs: jest.fn() }))
jest.mock('../../../utils/backends/Users/usersFirestore', () => ({ watchProjectUsers: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({
    globalWatcherUnsub: {},
    getDb: jest.fn(),
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    ...jest.requireActual('../../../utils/backends/openTasks'),
    watchAllGoals: jest.fn(),
    watchAllMilestones: jest.fn(),
}))
jest.mock('@hello-pangea/dnd', () => ({ DragDropContext: ({ children }) => children }))
jest.mock('../../DragSystem/DragHelper', () => ({ onBeforeCapture: jest.fn(), onDragEnd: jest.fn() }))
jest.mock('./OpenTaskViewForAssistants/AssistantScheduleTimeline', () => 'AssistantScheduleDateSection')
jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))

const PROJECT = 'at-2671-project'
const USER = 'at-2671-reviewer'
const OWNER = 'at-2671-owner'
const INSTANCE = PROJECT + USER
const task = { id: 'returning-task', userId: OWNER, userIds: [OWNER, USER], stepHistory: ['open', 'review'] }
const owner = { uid: OWNER, displayName: 'Owner', workflow: { [PROJECT]: { review: { reviewerUid: USER } } } }
const workflowDay = () => ['0', 1, 0, [], [], [], [[OWNER, [['0', [task]]]]], [], [], [], [], []]
const emptyDay = () => ['0', 0, 0, [], [], [], [], [], [], [], [], []]
const count = (tree, type) => tree.root.findAllByType(type).length

describe('workflow task returns to an All Done project (AT-2671)', () => {
    let tree

    beforeEach(() => {
        jest.clearAllMocks()
        resetProjectDataLoaderForTests()
        const user = { uid: USER, projectIds: [PROJECT], isAnonymous: false }
        store.dispatch({
            type: 'Test fixture',
            state: {
                loggedUser: user,
                currentUser: user,
                selectedProjectIndex: -1,
                loggedUserProjectsMap: { [PROJECT]: { id: PROJECT, index: 0, color: '#2F80ED' } },
                projectUsers: { [PROJECT]: [] },
                openMilestonesByProjectInTasks: { [PROJECT]: [] },
                doneMilestonesByProjectInTasks: { [PROJECT]: [] },
                goalsByProjectInTasks: { [PROJECT]: {} },
                okrsByProjectInTasks: { [PROJECT]: [] },
                openTasksStore: {},
                filteredOpenTasksStore: {},
                thereAreNotTasksInFirstDay: {},
                initialLoadingEndOpenTasks: {},
                initialLoadingEndObservedTasks: {},
                hashtagFilters: new Map(),
                taskPriorityFilters: [],
                taskVmStateFilters: [],
                subtaskByTaskStore: {},
            },
        })
        updateOpTasks(PROJECT, INSTANCE, [emptyDay()], true, null, false)
        updateOpTasks(PROJECT, INSTANCE, [emptyDay()], false, null, false)
        act(() => {
            tree = renderer.create(
                <Provider store={store}>
                    <OpenTasksByProject projectId={PROJECT} sortedLoggedUserProjectIds={[PROJECT]} />
                </Provider>
            )
        })
    })

    afterEach(() => {
        act(() => tree.unmount())
        resetProjectDataLoaderForTests()
    })

    const publish = day => act(() => updateOpTasks(PROJECT, INSTANCE, [day], true, null, false))
    const deliverUsers = users => act(() => watchProjectUsers.mock.calls[0][1](users))

    it('loads the workflow owner and reveals the task without an Add Task interaction', () => {
        expect(count(tree, 'ProjectHeader')).toBe(0)
        expect(watchProjectUsers).not.toHaveBeenCalled()

        publish(workflowDay())

        expect(count(tree, 'AddTask')).toBe(1)
        expect(watchProjectUsers).toHaveBeenCalledTimes(1)
        expect(watchProjectUsers.mock.calls[0][0]).toBe(PROJECT)
        expect(count(tree, 'TasksList')).toBe(0)

        // The real loader publishes into Redux; useSelector must repaint the section on its own.
        deliverUsers([owner])

        expect(tree.root.findByType('TasksList').props.taskList).toEqual([task])
        expect(tree.root.findByType('WorkflowHeader').props.assignee).toEqual(owner)

        publish(emptyDay())
        expect(count(tree, 'ProjectHeader')).toBe(0)
        publish(workflowDay())
        expect(tree.root.findByType('TasksList').props.taskList).toEqual([task])
        expect(watchProjectUsers).toHaveBeenCalledTimes(1)
    })

    it('renders immediately with retained users and keeps their workflow data reactive', () => {
        act(() => store.dispatch(setUsersInProject(PROJECT, [owner])))
        publish(workflowDay())
        expect(tree.root.findByType('TasksList').props.taskList).toEqual([task])

        deliverUsers([{ ...owner, displayName: 'Updated owner' }])
        expect(tree.root.findByType('WorkflowHeader').props.assignee.displayName).toBe('Updated owner')
    })

    it('requests one shared users listener for multiple returning workflow sections', () => {
        const day = workflowDay()
        day[6].push([OWNER, [['0', [{ ...task, id: 'another-task', stepHistory: ['open', 'other-review'] }]]]])
        publish(day)
        expect(watchProjectUsers).toHaveBeenCalledTimes(1)
        deliverUsers([owner])
        expect(count(tree, 'TasksList')).toBe(2)
    })

    it('also reveals workflow tasks grouped under a parent goal when their owner arrives', () => {
        const day = workflowDay()
        day[6][0][1][0][0] = 'parent-goal'
        publish(day)
        expect(count(tree, 'ParentGoalSection')).toBe(0)
        deliverUsers([owner])
        const section = tree.root.findByType('ParentGoalSection')
        expect(section.props.goalId).toBe('parent-goal')
        expect(section.props.taskList).toEqual([task])
        expect(section.props.isToReviewTask).toBe(true)
    })
})
