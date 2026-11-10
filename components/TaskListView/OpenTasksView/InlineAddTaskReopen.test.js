import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { Provider } from 'react-redux'
import { applyMiddleware, createStore } from 'redux'

import NewTaskSection from './NewTaskSection'
import { InlineAddTaskReopenScope } from './inlineAddTaskReopen'

let mockStore
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStore.getState(),
        dispatch: action => mockStore.dispatch(action),
        subscribe: listener => mockStore.subscribe(listener),
    },
}))

// NewTaskSection, DismissibleItem/Modal, EditTask, the editor lock and the Redux draft stay real.
// The input stands in for Quill (which cannot run under jsdom): like CustomTextInput3 it starts
// from `getInitialText()` and focuses itself on mount.
jest.mock('../TaskItem/TaskInputArea', () => {
    const React = require('react')
    return function Input({ inputTask, onChangeInputText, getInitialText }) {
        const element = React.useRef()
        const [value, setValue] = React.useState(() => getInitialText() || '')
        React.useImperativeHandle(inputTask, () => ({
            focus: () => element.current.focus(),
            clear: () => setValue(''),
        }))
        React.useEffect(() => {
            inputTask.current.focus()
        }, [])
        return (
            <textarea
                ref={element}
                aria-label="Task draft"
                value={value}
                onChange={event => {
                    setValue(event.target.value)
                    onChangeInputText(event.target.value, [], [], [], [], [], [], [])
                }}
            />
        )
    }
})
jest.mock('../AddTask', () => ({ toggleModal }) => <button onClick={toggleModal}>New task line</button>)
jest.mock(
    '../InlineAddTaskFileDrop',
    () =>
        ({ children }) =>
            children
)
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
jest.mock('../../../utils/backends/openTasks', () => ({ DATE_TASK_INDEX: 0, TODAY_DATE: '0' }))
jest.mock('../../../utils/backends/Goals/goalsFirestore', () => ({ getGoalData: jest.fn(), watchGoal: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({ unwatch: jest.fn(), setLinkedParentObjects: jest.fn() }))
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { unwatch: jest.fn(), watchGoal: jest.fn() },
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../../utils/LinkingHelper', () => ({ getLinkedParentUrl: () => '' }))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({ updateFocusedTask: jest.fn() }))
jest.mock('../../../utils/backends/Tasks/TaskServiceFrontendHelper', () => ({
    createTaskWithService: jest.fn(task => Promise.resolve({ ...task, id: 'new-task' })),
}))
jest.mock('../../../utils/backends/Notes/notesFirestore', () => ({ updateNoteTitleWithoutFeed: jest.fn() }))
jest.mock('../../../utils/backends/Chats/chatsFirestore', () => ({ updateChatTitleWithoutFeeds: jest.fn() }))

const instanceKey = 'project-1user-1'
const arrayActions =
    ({ dispatch }) =>
    next =>
    action =>
        Array.isArray(action) ? action.map(dispatch) : next(action)

const reducer = (state, action) => {
    if (Array.isArray(action)) return action.reduce(reducer, state)
    switch (action.type) {
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
        default:
            return state
    }
}

// The two places the board renders today's general composer for one project: inside the today
// section (MainSection) and, when the list has no date sections, the missing-dates composer
// (OpenTasksByProject, AT-2672). Swapping between them replaces the composer's parent.
function Board({ parent, goalId = null, scoped = true }) {
    const goal = goalId ? { id: goalId } : null
    const line =
        parent === 'section' ? (
            <section key="section">
                <NewTaskSection
                    projectId="project-1"
                    instanceKey={instanceKey}
                    dateIndex={0}
                    originalParentGoal={goal}
                />
            </section>
        ) : (
            <aside key="fallback">
                <NewTaskSection projectId="project-1" instanceKey={instanceKey} dateIndex={0} />
            </aside>
        )
    return scoped ? <InlineAddTaskReopenScope>{line}</InlineAddTaskReopenScope> : line
}

describe('inline add-task editor survives a rebuilt parent (AT-3010)', () => {
    let container, root
    const input = () => container.querySelector('textarea')
    const type = text => act(() => Simulate.change(input(), { target: { value: text } }))
    const render = async props =>
        act(async () =>
            root.render(
                <Provider store={mockStore}>
                    <Board {...props} />
                </Provider>
            )
        )

    beforeEach(() => {
        jest.clearAllMocks()
        global.IS_REACT_ACT_ENVIRONMENT = true
        mockStore = createStore(
            reducer,
            {
                filteredOpenTasksStore: { [instanceKey]: [['0']] },
                currentUser: { uid: 'user-1' },
                loggedUser: { uid: 'user-1', projectIds: ['project-1'], templateProjectIds: [] },
                selectedProjectIndex: 0,
                selectedNavItem: 'TASKS',
                showFloatPopup: 0,
                showConfirmPopupData: { visible: false, trigger: null },
                activeEditMode: false,
                taskEditorCount: 0,
                tmpInputTextTask: '',
                lastAddNewTaskDate: null,
                addTaskRepeatMode: false,
                addTaskSectionToOpenData: null,
                showGlobalSearchPopup: false,
                blockShortcuts: false,
            },
            applyMiddleware(arrayActions)
        )
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    const openAndType = async (text, props = { parent: 'section' }) => {
        await render(props)
        await act(async () => Simulate.click(container.querySelector('button')))
        type(text)
        expect(document.activeElement).toBe(input())
    }

    it('keeps the editor open, focused and holding the draft when the board swaps its parent', async () => {
        await openAndType('Buy milk')

        await render({ parent: 'fallback' })

        expect(input()).not.toBeNull()
        expect(input().value).toBe('Buy milk')
        expect(document.activeElement).toBe(input())
        expect(container.querySelector('button')).toBeNull() // No closed placeholder line instead.
        expect(mockStore.getState().taskEditorCount).toBe(1)
        expect(mockStore.getState().activeEditMode).toBe(true)

        // And back again when the today section is published.
        type('Buy milk and eggs')
        await render({ parent: 'section' })
        expect(input().value).toBe('Buy milk and eggs')
        expect(document.activeElement).toBe(input())
    })

    it('does not reopen an editor the user closed before the rebuild', async () => {
        await openAndType('Draft')
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 })))
        expect(input()).toBeNull()

        await render({ parent: 'fallback' })

        expect(input()).toBeNull()
        expect(container.querySelector('button')).not.toBeNull()
        expect(mockStore.getState().taskEditorCount).toBe(0)
    })

    it('does not reopen the editor on a different line (another goal)', async () => {
        await openAndType('Goal draft', { parent: 'section', goalId: 'goal-1' })

        await render({ parent: 'fallback' })

        expect(input()).toBeNull()
        expect(container.querySelector('button')).not.toBeNull()
    })

    it('does not reopen once the board itself is gone (project switch, other tab)', async () => {
        await openAndType('Draft', { parent: 'section' })
        await act(async () => root.render(<Provider store={mockStore}>{null}</Provider>))

        await render({ parent: 'fallback' })

        expect(input()).toBeNull()
        expect(container.querySelector('button')).not.toBeNull()
    })

    it('outside a board scope it behaves exactly as before', async () => {
        await openAndType('Draft', { parent: 'section', scoped: false })

        await render({ parent: 'fallback', scoped: false })

        expect(input()).toBeNull()
        expect(container.querySelector('button')).not.toBeNull()
        expect(mockStore.getState().tmpInputTextTask).toBe('Draft') // The draft itself was always kept.
    })
})
