/**
 * @jest-environment jsdom
 *
 * Holding the mic in the "add new task" field must CREATE the task (AT-2405 follow-up).
 *
 * The symptom in production was that it did the opposite of that: you held the mic over the inline
 * add-task input, said "Buy milk", and the editor closed without creating anything. The dictated
 * text was not lost - it survived in `tmpInputTextTask` and reappeared the next time the field was
 * opened - which is what made it read as "dictation randomly cancels my task" rather than as a
 * crash. Nothing threw, nothing logged, and every stage of the recording had in fact worked.
 *
 * Root cause, in one sentence: the input submitted through a closure that was one render too old.
 * A transcript arrives in a single `updateContents`, which synchronously calls `onChangeText` ->
 * EditTask's `onChangeInputText` -> `setTmpTask(...)`. That setState is only QUEUED (React 18
 * auto-batches updates made outside an event handler, and the transcript is delivered from a
 * promise continuation), so the `onKeyEnterPressed` that existed at that instant still closed over
 * the PRE-dictation draft, where `hasName === false`. EditTask then took the branch that exists for
 * pressing Enter on an empty add field:
 *
 *     if (hasName) { adding ? createTask(...) : editTask(...) }
 *     else if (adding) { dismissEditMode() }        // <- what actually ran
 *
 * The fix (`components/Feeds/CommentsTextInput/dictationSubmit.js`) is about ORDERING, not about
 * the submit itself: arming bumps a reducer so React must run one more render+commit pass - the
 * same batch the host's own setState is queued in - and a post-commit effect then resolves the host
 * callback out of a ref written during render, so it fires the freshest closure that exists.
 *
 * WHY THIS SUITE DRIVES THE REAL `EditTask`
 *
 * The bug lives in the COMPOSITION of three real pieces - React's batching, EditTask's `hasName`
 * guard, and the hook's commit-ordering - and in none of them alone. A stand-in host would have to
 * reproduce EditTask's queued-state-plus-empty-name branch to be able to fail, i.e. it would be a
 * restatement of the fix rather than a test of it, and it would keep passing if someone later
 * rewrote `onKeyEnterPressed`. So the real component is rendered with `adding={true}` and only its
 * text input is replaced - by a stub that wires the REAL `useDictationSubmit` exactly the way
 * CustomTextInput3 does (`onChangeInputText(text)` and then `armDictationSubmit(() => text)` in one
 * synchronous block, which is precisely what the recorder does) and exposes that block to the test.
 * `useSingleFlightSubmit` is real too, since it sits between the Enter action and the creation.
 *
 * The second test pins the pre-fix path itself: submitting in the same tick, without the hook,
 * still dismisses and still creates nothing. That is the behaviour the hook exists to prevent, and
 * keeping it here is what stops "simplify the arming away" from looking harmless.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import EditTask from './EditTask'
import { createTaskWithService } from '../../../utils/backends/Tasks/TaskServiceFrontendHelper'

// Set during the stub input's render, so they always close over the props of the LAST render -
// exactly like the quill callbacks inside CustomTextInput3.
let mockDictate = null
let mockSubmitInSameTick = null

const mockState = {
    currentUser: { uid: 'user-1' },
    loggedUser: { uid: 'user-1', isAnonymous: false },
    addTaskRepeatMode: false,
    selectedProjectIndex: 0,
    isMiddleScreen: false,
    showGlobalSearchPopup: false,
    selectedNavItem: 'TASKS',
    addTaskSectionToOpenData: null,
}

const mockStoreState = {
    showFloatPopup: 0,
    tmpInputTextTask: '',
    loggedUser: { uid: 'user-1' },
}

const mockNewDefaultTask = () => ({
    done: false,
    inDone: false,
    name: '',
    extendedName: '',
    description: '',
    userId: 'user-1',
    userIds: ['user-1'],
    currentReviewerId: 'user-1',
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    stepHistory: ['open'],
    hasStar: '#FFFFFF',
    priority: 0,
    created: 1700000000000,
    creatorId: 'user-1',
    dueDate: 1700000000000,
    completed: null,
    isPrivate: false,
    isPublicFor: ['all'],
    parentId: null,
    isSubtask: false,
    subtaskIds: [],
    subtaskNames: [],
    recurrence: 'never',
    lastEditorId: 'user-1',
    lastEditionDate: 1700000000000,
    linkBack: '',
    estimations: {},
    comments: [],
    commentsData: null,
    genericData: null,
    calendarData: null,
    gmailData: null,
    sortIndex: 0,
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    noteId: null,
    lockKey: '',
})

// The only piece of the real editor that is replaced: a faithful re-wiring of how
// CustomTextInput3 hands a dictation to its host.
jest.mock('./TaskInputArea', () => {
    const useDictationSubmit = require('../../Feeds/CommentsTextInput/dictationSubmit').default

    return function TaskInputAreaStub({ onChangeInputText, onKeyEnterPressed }) {
        const armDictationSubmit = useDictationSubmit({
            forceTriggerEnterActionForBreakLines: onKeyEnterPressed,
        })

        // What the recorder does, in one synchronous block: the transcript insertion calls
        // onChangeText (-> the host's setState, which is only QUEUED), then the input is asked to
        // fire its own Enter action.
        mockDictate = text => {
            onChangeInputText(text, [], [], [], [], [], [], [])
            armDictationSubmit(() => text)
        }

        // The pre-fix shape of the very same block: resolve and call the host action immediately.
        mockSubmitInSameTick = text => {
            onChangeInputText(text, [], [], [], [], [], [], [])
            onKeyEnterPressed()
        }

        return null
    }
})

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockStoreState, dispatch: jest.fn(), subscribe: jest.fn() },
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: jest.fn(),
    resetFloatPopup: jest.fn(),
    setActiveEditMode: jest.fn(),
    setFocusedTaskItem: jest.fn(),
    setLastAddNewTaskDate: jest.fn(),
    setSelectedNavItem: jest.fn(),
    setSelectedSidebarTab: jest.fn(),
    setTmpInputTextTask: jest.fn(),
    setUploadedNewSubtask: jest.fn(),
    showConfirmPopup: jest.fn(),
    showFloatPopup: jest.fn(),
    unsetActiveEditMode: jest.fn(),
    unsetAddTaskRepeatMode: jest.fn(),
    updateTaskSuggestedCommentModalData: jest.fn(),
}))

jest.mock('../Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getNewDefaultTask: jest.fn(() => mockNewDefaultTask()),
        getTaskNameWithoutMeta: jest.fn(name => name),
        getUserInProject: jest.fn(() => ({ uid: 'user-1' })),
        getTaskOwner: jest.fn(() => ({ uid: 'user-1', workflow: null })),
        getMentionUsersFromTitle: jest.fn(() => []),
        getNoteTitleForTask: jest.fn(() => ''),
    },
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    OPEN_STEP: 'open',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false),
        getProjectById: jest.fn(() => ({ id: 'project-1' })),
    },
}))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { accessGranted: jest.fn(() => true) },
}))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: jest.fn() },
}))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../utils/LinkingHelper', () => ({ getLinkedParentUrl: jest.fn(() => '') }))
jest.mock('../../../hooks/useRevealEditorOnOpen', () => ({ __esModule: true, default: jest.fn() }))

jest.mock('../../../utils/backends/firestore', () => ({ setLinkedParentObjects: jest.fn() }))
jest.mock('../../../utils/backends/openTasks', () => ({ TODAY_DATE: 'Today' }))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    createFollowUpTask: jest.fn(),
    setTaskProjectWithGoal: jest.fn(),
    updateTask: jest.fn(() => Promise.resolve()),
    updateFocusedTask: jest.fn(),
    uploadNewSubTask: jest.fn(() => Promise.resolve({ id: 'subtask-1' })),
}))
jest.mock('../../../utils/backends/Tasks/TaskServiceFrontendHelper', () => ({
    createTaskWithService: jest.fn(() => Promise.resolve({ id: 'task-1', extendedName: 'Buy milk' })),
}))
jest.mock('../../../utils/backends/Notes/notesFirestore', () => ({ updateNoteTitleWithoutFeed: jest.fn() }))
jest.mock('../../../utils/backends/Chats/chatsFirestore', () => ({ updateChatTitleWithoutFeeds: jest.fn() }))

jest.mock('./MainButtonsArea', () => 'MainButtonsArea')
jest.mock('./SecondaryButtonsArea', () => 'SecondaryButtonsArea')
jest.mock('./CheckboxAndIcon', () => 'CheckboxAndIcon')
jest.mock('../../UIControls/EditAssigneeWrapper/EditAssigneeWrapper', () => 'EditAssigneeWrapper')
jest.mock('../../UIComponents/ConfirmPopup', () => ({ CONFIRM_POPUP_TRIGGER_DELETE_TASK: 'DELETE_TASK' }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

let tree
let onCancelAction

const renderAddTaskEditor = () => {
    onCancelAction = jest.fn()
    act(() => {
        tree = renderer.create(
            <EditTask
                adding={true}
                isSubtask={false}
                projectId="project-1"
                useLoggedUser={true}
                inBacklog={false}
                defaultDate={1700000000000}
                dateFormated="Today"
                onCancelAction={onCancelAction}
            />
        )
    })
}

describe('dictating into the add-new-task field', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDictate = null
        mockSubmitInSameTick = null
    })

    afterEach(() => {
        act(() => {
            tree?.unmount()
        })
        tree = null
    })

    test('creates the task the transcript just wrote, instead of dismissing the editor', async () => {
        renderAddTaskEditor()

        act(() => {
            mockDictate('Buy milk')
        })

        expect(createTaskWithService).toHaveBeenCalledTimes(1)
        const [createdTask] = createTaskWithService.mock.calls[0]
        expect(createdTask.name).toBe('Buy milk')
        expect(createdTask.extendedName).toBe('Buy milk')
        expect(createdTask.projectId).toBe('project-1')

        // `dismissEditMode()` (the empty add-field branch) passes no argument, while the dismiss
        // that follows a successful creation passes `true`. Distinguishing the two is what says
        // the editor closed BECAUSE the task was created, not instead of creating it.
        expect(onCancelAction).not.toHaveBeenCalledWith(undefined)
        expect(onCancelAction).toHaveBeenCalledWith(true)

        await act(async () => {})
    })

    test('does not submit synchronously - arming waits for the commit that carries the transcript', () => {
        renderAddTaskEditor()

        act(() => {
            mockDictate('Buy milk')
            // Still inside the recorder's own synchronous block: the host has not re-rendered yet,
            // so submitting here is exactly what shipped the bug.
            expect(createTaskWithService).not.toHaveBeenCalled()
        })

        expect(createTaskWithService).toHaveBeenCalledTimes(1)
    })

    // THE PRE-FIX PATH, kept as documentation of why the hook exists. This is what
    // CustomTextInput3 used to do: resolve the host's Enter action and call it in the same tick as
    // the transcript insertion. The host's setState is still queued, so `hasName` is false and
    // EditTask dismisses an add field it believes is empty.
    test('submitting in the same tick (pre-fix) dismisses the editor and creates nothing', () => {
        renderAddTaskEditor()

        act(() => {
            mockSubmitInSameTick('Buy milk')
        })

        expect(createTaskWithService).not.toHaveBeenCalled()
        expect(onCancelAction).toHaveBeenCalledWith(undefined)
    })
})
