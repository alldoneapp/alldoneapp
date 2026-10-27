/**
 * @jest-environment jsdom
 */

// AT-2886: the task DV kept its live task listener only until the first tab switch. The
// `[selectedTab]` effect's cleanup called `Backend.offOnSingleTaskChange()`, while the listener
// itself was only ever started by the `[projectId, task.id]` effect, so switching e.g. Properties ->
// Chat left `task` frozen. The chat composer then read a stale `isAssistantEnabled: true` after the
// user switched the assistant off, and still started an assistant run.

import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUserProjectsMap: { 'project-1': { id: 'project-1', index: 0 } },
    loggedUser: { uid: 'user-1', isAnonymous: false, unlockedKeysByGuides: {} },
    selectedNavItem: 'TASK_PROPERTIES',
    smallScreenNavigation: false,
    isMiddleScreen: false,
    showWebSideBar: { visible: false },
    taskInDetailView: {},
    currentUser: {},
}

const mockListeners = []
const mockBackend = {
    onSingleTaskChange: jest.fn((projectId, taskId, callback) => {
        const listener = { projectId, taskId, callback, active: true }
        mockListeners.push(listener)
    }),
    offOnSingleTaskChange: jest.fn(() => {
        // Mirrors utils/backends/firestore.js: one module-level subscription.
        mockListeners.forEach(listener => {
            listener.active = false
        })
    }),
    getUserOrContactBy: jest.fn(() => Promise.resolve(null)),
}
const activeListeners = () => mockListeners.filter(listener => listener.active)

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))

jest.mock('../../redux/store', () => ({ getState: () => mockState, dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => new Proxy({}, { get: (target, name) => jest.fn(() => ({ type: name })) }))
jest.mock('../../utils/BackendBridge', () => mockBackend)

const mockView = name => {
    const React = require('react')
    const { View } = require('react-native')
    const Component = React.forwardRef((props, ref) => <View testID={name} {...props} />)
    return { __esModule: true, default: Component }
}
jest.mock('./Header/Header', () => mockView('Header'))
jest.mock('../NavigationBar/NavigationBar', () => mockView('NavigationBar'))
jest.mock('./Properties/PropertiesView', () => mockView('PropertiesView'))
jest.mock('./SubtasksView/SubtasksView', () => mockView('SubtasksView'))
jest.mock('./Estimations/WorkflowEstimation', () => mockView('WorkflowEstimation'))
jest.mock('../SidebarMenu/CustomSideMenu', () => mockView('CustomSideMenu'))
jest.mock('./Header/BackButton', () => mockView('BackButton'))
jest.mock('../UIComponents/LoadingData', () => mockView('LoadingData'))
jest.mock('../Feeds/RootViewFeedsTask', () => mockView('RootViewFeedsTask'))
jest.mock('../UIControls/CustomScrollView', () => mockView('CustomScrollView'))
jest.mock('../BacklinksView/BacklinksView', () => mockView('BacklinksView'))
jest.mock('../ChatsView/ChatDV/ChatBoard', () => mockView('ChatBoard'))
jest.mock('../NoteIntegration/NoteIntegration', () => mockView('NoteIntegration'))
jest.mock('../RootView/GoldAnimationsContainer', () => mockView('GoldAnimationsContainer'))
jest.mock('./TaskChatWorkflowControls', () => mockView('TaskChatWorkflowControls'))

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectById: () => ({ id: 'project-1' }) }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../utils/LinkingHelper', () => ({ LINKED_OBJECT_TYPE_TASK: 'task' }))
jest.mock('../../utils/SharedHelper', () => ({ accessGranted: () => true, changeSharedMode: jest.fn() }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { isPrivateTask: () => false, changeSharedMode: jest.fn() },
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../hooks/usePrivateProject', () => jest.fn())
jest.mock('../Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
jest.mock('../SettingsView/ProjectsSettings/ProjectsSettings', () => ({ PROJECT_TYPE_SHARED: 1 }))
jest.mock('../SidebarMenu/Collapsible/UseCollapsibleSidebar', () => () => ({ overlay: false }))
jest.mock('../styles/global', () => ({ SIDEBAR_MENU_COLLAPSED_WIDTH: 56 }))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => null }))
jest.mock('../../hooks/useResetDetailedViewScroll', () => jest.fn())
jest.mock('./useTaskProjectMoveHandoff', () => () => ({ handleSourceTaskChange: () => false }))

const TaskDetailedView = require('./TaskDetailedView').default

const initialTask = {
    id: 'task-1',
    name: 'Bring Juno MCP to the stores',
    extendedName: 'Bring Juno MCP to the stores',
    userId: 'user-1',
    assistantId: 'assistant-1',
    isAssistantEnabled: true,
    isPublicFor: [0],
}

const navigation = {
    getParam: (key, fallback) => ({ task: initialTask, projectId: 'project-1' })[key] ?? fallback,
}

const render = () => {
    let tree
    act(() => {
        tree = renderer.create(<TaskDetailedView navigation={navigation} />)
    })
    return tree
}

const selectTab = (tree, tab) => {
    mockState.selectedNavItem = tab
    act(() => {
        tree.update(<TaskDetailedView navigation={navigation} />)
    })
}

describe('TaskDetailedView live task listener (AT-2886)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockListeners.length = 0
        mockState.selectedNavItem = 'TASK_PROPERTIES'
        mockState.taskInDetailView = {}
    })

    it('keeps listening to the task after switching to the chat tab', () => {
        const tree = render()
        expect(activeListeners()).toHaveLength(1)

        selectTab(tree, 'TASK_CHAT')
        expect(activeListeners()).toHaveLength(1)
        expect(activeListeners()[0]).toMatchObject({ projectId: 'project-1', taskId: 'task-1' })

        act(() => tree.unmount())
    })

    it('hands the chat composer the assistant switch-off made after the tab change', () => {
        const tree = render()
        selectTab(tree, 'TASK_CHAT')

        // The user switches the assistant off; Firestore echoes the local write to the listener.
        act(() => {
            activeListeners().forEach(listener => listener.callback({ ...initialTask, isAssistantEnabled: false }))
        })

        const chatBoard = tree.root.findByProps({ testID: 'ChatBoard' })
        expect(chatBoard.props.parentObject.isAssistantEnabled).toBe(false)

        act(() => tree.unmount())
    })

    it('stops listening when the view unmounts', () => {
        const tree = render()
        selectTab(tree, 'TASK_CHAT')
        act(() => tree.unmount())
        expect(activeListeners()).toHaveLength(0)
    })
})
