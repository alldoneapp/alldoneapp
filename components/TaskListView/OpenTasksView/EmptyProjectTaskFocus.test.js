import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { Provider } from 'react-redux'
import { applyMiddleware, createStore } from 'redux'

import MainSection from './MainSection'
import { createTaskWithService } from '../../../utils/backends/Tasks/TaskServiceFrontendHelper'

let mockStore
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStore.getState(),
        dispatch: action => mockStore.dispatch(action),
        subscribe: listener => mockStore.subscribe(listener),
    },
}))

// Keep the board, NewTaskSection, DismissibleItem/Modal, EditTask, Redux subscriptions and
// keyboard handlers real. Isolate Quill rendering and backend writes: the failure is the
// board removing the focused editor's parent when an empty list hydrates.
jest.mock('../TaskItem/TaskInputArea', () => {
    const React = require('react')
    return function Input({ tmpTask, inputTask, onChangeInputText }) {
        const element = React.useRef()
        React.useImperativeHandle(inputTask, () => ({
            focus: () => element.current.focus(),
            clear: () => {}, // EditTask resets tmpTask before calling clear.
        }))
        React.useEffect(() => {
            inputTask.current.focus()
        }, [])
        return (
            <textarea
                ref={element}
                aria-label="Task draft"
                value={tmpTask.extendedName}
                onChange={event => onChangeInputText(event.target.value, [], [], [], [], [], [], [])}
            />
        )
    }
})
jest.mock('../AddTask', () => ({ toggleModal }) => <button onClick={toggleModal}>New task line</button>)
jest.mock('../TaskItem/MainButtonsArea', () => () => null)
jest.mock('../TaskItem/SecondaryButtonsArea', () => () => null)
jest.mock('../TaskItem/CheckboxAndIcon', () => () => null)
jest.mock('../../UIControls/EditAssigneeWrapper/EditAssigneeWrapper', () => () => null)
jest.mock('../../UIComponents/ConfirmPopup', () => ({ CONFIRM_POPUP_TRIGGER_DELETE_TASK: 'DELETE_TASK' }))
jest.mock('../../../hooks/useRevealEditorOnOpen', () => () => {})
jest.mock('../../../utils/popupDismissGuard', () => ({
    registerPopupDismiss: jest.fn(),
    shouldBlockPressAfterPopupDismiss: () => false,
}))
jest.mock('./ParentGoalSection', () => () => <div>Goal tasks</div>)
jest.mock('./EmptyGoal', () => () => <div>Empty goal</div>)
jest.mock('./TasksList', () => ({ taskList }) => <div>{taskList.map(task => task.name).join(',')}</div>)
jest.mock('./SwipeableGeneralTasksHeader', () => () => null)
jest.mock('./GeneralTasksHeader', () => () => null)
jest.mock('../../GoalsView/SortModeActiveInfo', () => () => null)
jest.mock('../../UIControls/ShowMoreButton', () => () => null)
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../utils/HelperFunctions', () => ({
    dismissAllPopups: jest.fn(),
    isInputsFocused: () => global.document.activeElement.tagName === 'TEXTAREA',
}))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: () => true, accessGranted: () => true },
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
    checkIfSelectedProject: () => true,
}))
jest.mock('../Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getNewDefaultTask: () => ({
            name: '',
            extendedName: '',
            userId: 'user-1',
            userIds: ['user-1'],
            subtaskIds: [],
            estimations: {},
            parentGoalId: null,
        }),
        getTaskNameWithoutMeta: name => name,
        getTaskOwner: () => ({ uid: 'user-1', workflow: null }),
    },
    BACKLOG_DATE_STRING: '99999999',
    OPEN_STEP: 'open',
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    DATE_TASK_INDEX: 0,
    MAIN_TASK_INDEX: 3,
    EMPTY_SECTION_INDEX: 11,
    NOT_PARENT_GOAL_INDEX: '0',
    TODAY_DATE: '0',
    sortGoalTasksGorups: (projectId, open, done, goals, user, groups) =>
        Object.fromEntries([['0', 0], ...groups.map(([id], index) => [id, index + 1])]),
}))
jest.mock('../../../utils/backends/Goals/goalsFirestore', () => ({ getGoalData: jest.fn(), watchGoal: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({ unwatch: jest.fn(), setLinkedParentObjects: jest.fn() }))
jest.mock('../../../utils/BackendBridge', () => ({ __esModule: true, default: { unwatch: jest.fn() } }))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../../utils/LinkingHelper', () => ({ getLinkedParentUrl: () => '' }))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({ updateFocusedTask: jest.fn() }))
jest.mock('../../../utils/backends/Tasks/TaskServiceFrontendHelper', () => ({
    createTaskWithService: jest.fn(task => Promise.resolve({ ...task, id: 'new-task' })),
}))
jest.mock('../../../utils/backends/Notes/notesFirestore', () => ({ updateNoteTitleWithoutFeed: jest.fn() }))
jest.mock('../../../utils/backends/Chats/chatsFirestore', () => ({ updateChatTitleWithoutFeeds: jest.fn() }))

const instanceKey = 'project-1user-1'
const day = (main = [], emptyGoals = []) => ['0', 0, 0, main, [], [], [], [], [], [], [], emptyGoals]
const task = { id: 'background-task', name: 'Background task' }
const arrayActions =
    ({ dispatch }) =>
    next =>
    action =>
        Array.isArray(action) ? action.map(dispatch) : next(action)

// Only the reducer slices these real components write are needed for this isolated board.
const reducer = (state, action) => {
    if (Array.isArray(action)) return action.reduce(reducer, state)
    switch (action.type) {
        case 'snapshot':
            return { ...state, filteredOpenTasksStore: { [instanceKey]: [action.day] } }
        case 'Set active edit mode':
            return { ...state, activeEditMode: true }
        case 'Unset active edit mode':
            return { ...state, activeEditMode: false }
        case 'Start task editor':
            return { ...state, taskEditorCount: state.taskEditorCount + 1 }
        case 'Finish task editor':
            return { ...state, taskEditorCount: state.taskEditorCount - 1 }
        case 'Set tmp input text task':
            return { ...state, tmpInputTextTask: action.text }
        case 'Set last add new task date':
            return { ...state, lastAddNewTaskDate: action.lastAddNewTaskDate }
        case 'repeat':
            return { ...state, addTaskRepeatMode: true }
        case 'Unset add task repeat mode':
            return { ...state, addTaskRepeatMode: false }
        default:
            return state
    }
}

describe('empty project task composer focus (AT-2698)', () => {
    let container, root
    const input = () => container.querySelector('textarea')
    const snapshot = nextDay => act(() => mockStore.dispatch({ type: 'snapshot', day: nextDay }))
    const type = text => act(() => Simulate.change(input(), { target: { value: text } }))
    const key = (key, options = {}) =>
        act(() => {
            input().dispatchEvent(
                new KeyboardEvent('keydown', { key, keyCode: key === 'Escape' ? 27 : 13, bubbles: true, ...options })
            )
        })
    const mount = async initialDay => {
        mockStore = createStore(
            reducer,
            {
                filteredOpenTasksStore: { [instanceKey]: [initialDay] },
                currentUser: { uid: 'user-1' },
                loggedUser: { uid: 'user-1', projectIds: ['project-1'], templateProjectIds: [], numberTodayTasks: 50 },
                thereAreHiddenNotMainTasks: {},
                taskPriorityFilters: [],
                taskVmStateFilters: [],
                openMilestonesByProjectInTasks: { 'project-1': [] },
                doneMilestonesByProjectInTasks: { 'project-1': [] },
                goalsByProjectInTasks: { 'project-1': {} },
                selectedProjectIndex: 0,
                selectedNavItem: 'TASKS',
                showFloatPopup: 0,
                showConfirmPopupData: { visible: false, trigger: null },
                activeEditMode: false,
                taskEditorCount: 0,
                tmpInputTextTask: '',
                lastAddNewTaskDate: null,
                addTaskRepeatMode: false,
                optimisticGoalPostpones: {},
            },
            applyMiddleware(arrayActions)
        )
        await act(async () =>
            root.render(
                <Provider store={mockStore}>
                    <MainSection projectId="project-1" dateIndex={0} instanceKey={instanceKey} />
                </Provider>
            )
        )
        await act(async () => Simulate.click(container.querySelector('button')))
    }
    beforeEach(() => {
        jest.clearAllMocks()
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it.each([
        ['general task', day([['0', [task]]])],
        ['goal task', day([['goal-1', [task]]])],
        ['empty goal', day([], [{ id: 'goal-1' }])],
    ])('keeps the same focused editor and draft when a %s arrives', async (label, nextDay) => {
        await mount(day())
        const focused = input()
        type('First draft')
        snapshot(day()) // Fresh but still-empty snapshots must be harmless too.
        expect(document.activeElement).toBe(focused)
        snapshot(nextDay)
        expect(input()).toBe(focused)
        expect(document.activeElement).toBe(focused)
        expect(focused.value).toBe('First draft')
        expect(mockStore.getState().taskEditorCount).toBe(1)
        expect(container.querySelectorAll('button')).toHaveLength(0) // No duplicate general composer.
        type('First draft continues')
        expect(document.activeElement).toBe(focused)
        key('Escape')
        expect(input()).toBeNull()
        expect(mockStore.getState().taskEditorCount).toBe(0)
        expect(createTaskWithService).not.toHaveBeenCalled()
    })

    it.each([
        ['empty', day()],
        ['hydrating', day()],
        ['nonempty', day([['0', [task]]])],
    ])('preserves Enter submission and ignores repeated/IME Enter on a %s project', async (label, initialDay) => {
        await mount(initialDay)
        type('New task')
        if (label === 'hydrating') snapshot(day([['0', [task]]]))
        key('Enter', { repeat: true })
        key('Enter', { isComposing: true })
        expect(createTaskWithService).not.toHaveBeenCalled()
        await act(async () => key('Enter'))
        expect(createTaskWithService).toHaveBeenCalledTimes(1)
        expect(createTaskWithService).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'project-1', name: 'New task', parentGoalId: null }),
            expect.anything()
        )
        expect(input()).toBeNull()
        expect(mockStore.getState().taskEditorCount).toBe(0)
    })

    it('keeps repeat-mode creation focused when the first submitted task appears', async () => {
        await mount(day())
        act(() => mockStore.dispatch({ type: 'repeat' }))
        const focused = input()
        type('First task')
        await act(async () => key('Enter'))
        snapshot(day([['0', [task]]]))
        expect(input()).toBe(focused)
        expect(document.activeElement).toBe(focused)
        expect(focused.value).toBe('')
        type('Second task')
        await act(async () => key('Enter'))
        expect(createTaskWithService).toHaveBeenCalledTimes(2)
        expect(createTaskWithService.mock.calls.map(([task]) => task.name)).toEqual(['First task', 'Second task'])
        key('Escape')
        expect(input()).toBeNull()
        expect(mockStore.getState().addTaskRepeatMode).toBe(false)
        expect(container.querySelectorAll('button')).toHaveLength(1)
    })

    it('still dismisses on a deliberate outside click after hydration', async () => {
        await mount(day())
        type('Draft')
        snapshot(day([['0', [task]]]))
        act(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })))
        expect(input()).toBeNull()
        expect(mockStore.getState().taskEditorCount).toBe(0)
        expect(createTaskWithService).not.toHaveBeenCalled()
    })

    it('preserves the + shortcut after leaving the hydrated composer', async () => {
        await mount(day())
        type('Draft + text')
        snapshot(day([['0', [task]]]))
        const focused = input()
        key('+')
        expect(input()).toBe(focused)
        key('Escape')
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })))
        expect(input()).not.toBeNull()
        expect(document.activeElement).toBe(input())
        expect(mockStore.getState().taskEditorCount).toBe(1)
        expect(createTaskWithService).not.toHaveBeenCalled()
    })
})
