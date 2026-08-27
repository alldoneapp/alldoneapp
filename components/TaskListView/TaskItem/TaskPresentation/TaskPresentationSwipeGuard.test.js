import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2449 — "after swiping left on a task and then dismissing the postpone popup by clicking next
 * to it, I can no longer click into the task in the task list view".
 *
 * `hooks/useSwipeCloseGuard.test.js` pins the RULE and `browser-tests/at2449` proves the whole
 * gesture in real Chromium against the real gesture handler. This suite is the middle piece the
 * other two cannot cover: that the real `TaskPresentation` is WIRED to the guard, and that the
 * value it hands its title (`blockOpen`) is the one that decides whether a press opens the task.
 * `SocialText` rejects every press while `blockOpen` is true (`shouldOnPressInput`), so a row left
 * with it set is exactly the reported symptom.
 *
 * The Swipeable double is not a convenience stub: it reproduces the CALLBACK ORDER of
 * `Swipeable._animateRow` — including the batched `rowState` write that is the whole reason a
 * programmatic `close()` has nothing to animate. See `__swipeableAnimateRowDouble.js`.
 */

jest.mock('react-redux', () => ({
    shallowEqual: (a, b) => a === b,
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            smallScreenNavigation: false,
            route: 'TasksView',
            selectedSidebarTab: 'tasks',
            taskViewToggleIndex: 0,
            selectedProjectIndex: 0,
            optimisticFocusTaskId: null,
            optimisticFocusActive: false,
            activeEditMode: false,
            lastTaskAddedId: null,
            currentUser: { uid: 'logged-user' },
            loggedUser: {
                uid: 'logged-user',
                showAllProjectsByTime: false,
                inFocusTaskId: null,
                activeTaskId: null,
                unlockedKeysByGuides: [],
                isAnonymous: false,
                projectIds: ['project-1'],
            },
        }),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(React.Fragment, null, children, isOpen ? content : null)
})
jest.mock('uuid/v4', () => () => 'checkbox-1')
jest.mock('../../../../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: 'logged-user' }, openModals: {}, isQuillTagEditorOpen: false }),
    dispatch: jest.fn(),
}))
jest.mock('../../../../redux/actions', () => ({
    setAssignee: jest.fn(),
    setSelectedNavItem: jest.fn(),
    setSwipeDueDatePopupData: jest.fn(),
    showSwipeDueDatePopup: jest.fn(),
}))
jest.mock('react-native-gesture-handler/Swipeable', () => require('./__swipeableAnimateRowDouble'))
jest.mock('./TaskFileDropZone', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('./taskFileDropHelper', () => ({ canDropFilesOnTaskRow: () => false }))
jest.mock('./TaskRoutingActivityOverlay', () => 'TaskRoutingActivityOverlay')
jest.mock('./useTaskRoutingActivity', () => ({
    __esModule: true,
    default: () => ({ processing: null, confirmation: null }),
}))
jest.mock('./taskAiStepControl', () => ({ shouldShowAiStepControl: () => false }))
jest.mock('./TaskTagsContainer', () => 'TaskTagsContainer')
jest.mock('./TaskTagsContainerByTime', () => 'TaskTagsContainerByTime')
jest.mock('./TitleContainer/TitleContainer', () => 'TitleContainer')
jest.mock('./ShortcutsArea/ShortcutsArea', () => 'ShortcutsArea')
jest.mock('../../SwipeAreasContainer', () => 'SwipeAreasContainer')
jest.mock('../../SixDotsContainer', () => 'SixDotsContainer')
jest.mock('../../LineOfTime', () => 'LineOfTime')
jest.mock('../../TaskPriorityTagButton', () => 'TaskPriorityTagButton')
jest.mock('../../useLastAddedTaskColor', () => ({ __esModule: true, default: () => '#ffffff' }))
jest.mock('../../TagsArea/taskTagSummaryHelper', () => ({ doTrailingTagsCrowdTaskTitle: () => false }))
jest.mock('../../../Tags/GmailTag', () => 'GmailTag')
jest.mock('../../../Tags/AlertTag', () => 'AlertTag')
jest.mock('../../../Tags/TranscribeTag', () => 'TranscribeTag')
jest.mock('../../../Tags/InProgressVmTag', () => 'TaskVmStatusTag')
jest.mock('../../../Tags/AssistantWorkflowRunTag', () => 'AssistantWorkflowRunTag')
jest.mock('../../../Tags/TaskRoutingTag', () => 'TaskRoutingTag')
jest.mock(
    '../../../UIComponents/FloatModals/RichCommentModal/CommentPopupWorkflowControls',
    () => 'CommentPopupWorkflowControls'
)
jest.mock('../../../MyPlatform', () => ({ getElementWidth: () => Promise.resolve(0) }))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false, getProjectNameById: () => 'Project' },
}))
jest.mock('../../../Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
jest.mock('../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    checkIfInMyDay: () => false,
    checkIfInMyDayOpenTab: () => false,
}))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: () => true },
}))
jest.mock('../../../../utils/useGetTaskWorkflow', () => ({ __esModule: true, default: () => ({}) }))
jest.mock('../../../../utils/Gmail/gmailTaskUtils', () => ({
    isInboxSummaryGmailTask: () => false,
    isGmailLabelFollowUpTask: () => false,
    getEmailTaskArchiveData: () => null,
}))
jest.mock('../../Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getTaskOwner: jest.fn(),
        showWrappedTaskEllipsis: () => false,
        showWrappedTaskEllipsisInByTime: () => false,
    },
    DONE_STEP: 'done',
    OPEN_STEP: 'open',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    dismissAllPopups: jest.fn(),
    getWorkflowStepsIdsSorted: () => [],
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../../utils/BackendBridge', () => ({ getTaskData: jest.fn() }))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention' }))
jest.mock('../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws_' }))
jest.mock('../../../ContactsView/Utils/ContactsHelper', () => ({ getUserWorkflow: () => ({}) }))
jest.mock('../../../Premium/PremiumHelper', () => ({ checkIsLimitedByXp: () => false }))
jest.mock('./CheckBoxContainer/TaskFlowModal', () => 'TaskFlowModal')
jest.mock('./CheckBoxContainer/EmailTaskCompletionModal', () => 'EmailTaskCompletionModal')
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromDone: jest.fn().mockResolvedValue(undefined),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskStatus: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal', () => ({
    __esModule: true,
    default: () => null,
    shouldShowRecurringTaskDateBasisModal: () => false,
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))

import TaskPresentation from './TaskPresentation'
import { RIGHT_ACTIONS_WIDTH, swipeableInstances } from './__swipeableAnimateRowDouble'

const baseTask = {
    id: 'task-1',
    name: 'Buy milk',
    extendedName: '',
    userId: 'logged-user',
    userIds: ['logged-user'],
    isSubtask: false,
    parentId: null,
    done: false,
    inDone: false,
    hasStar: '#FFFFFF',
    estimations: { open: 15 },
    genericData: true,
    isPrivate: false,
    calendarData: null,
    gmailData: null,
    stepHistory: [],
}

const renderRow = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(<TaskPresentation projectId={'project-1'} task={baseTask} />)
        await Promise.resolve()
        await Promise.resolve()
    })
    return tree
}

// What the row hands its own title, i.e. what actually gates the press.
const blockOpenOf = tree => tree.root.findByType('TitleContainer').props.blockOpen

describe('TaskPresentation swipe close guard (AT-2449)', () => {
    let consoleLogSpy

    beforeEach(() => {
        swipeableInstances.length = 0
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
    })

    it('leaves the row openable after a right swipe opens the postpone popup', async () => {
        const tree = await renderRow()
        const swipeable = swipeableInstances[0]

        expect(blockOpenOf(tree)).toBe(false)

        // The gesture the user makes: drag left past the threshold and let go.
        // `TaskPresentation.onRightSwipe` closes the row from inside that handler,
        // which is the close that settles synchronously and inverts the pair.
        await act(async () => {
            swipeable.releaseRightSwipe()
            await Promise.resolve()
        })

        expect(swipeable.emitted).toEqual([
            // `_animateRow(0, -width)` → the app's handler → `close()` → `_animateRow(0, 0)`,
            // whose spring settles inside `.start()`.
            'onSwipeableRightWillOpen',
            'onSwipeableClose',
            'onSwipeableWillClose',
            'onSwipeableWillOpen',
        ])
        expect(blockOpenOf(tree)).toBe(false)
    })

    it('still blocks the press that closes a row the user left open', async () => {
        const tree = await renderRow()
        const swipeable = swipeableInstances[0]

        // A row sitting open: closing it has real distance to travel, so the
        // spring resolves in a later frame and the pair arrives in order.
        act(() => swipeable.forceOpen(-RIGHT_ACTIONS_WIDTH))
        act(() => swipeable.close())
        expect(blockOpenOf(tree)).toBe(true)

        act(() => swipeable.settleClose())
        expect(blockOpenOf(tree)).toBe(false)
    })

    it('releases a close that never lands because the row is opened again', async () => {
        const tree = await renderRow()
        const swipeable = swipeableInstances[0]

        act(() => swipeable.forceOpen(-RIGHT_ACTIONS_WIDTH))
        act(() => swipeable.close())
        expect(blockOpenOf(tree)).toBe(true)

        // The close animation is interrupted: no completion callback is ever
        // delivered for it.
        act(() => swipeable.forceReopen(-RIGHT_ACTIONS_WIDTH))
        expect(blockOpenOf(tree)).toBe(false)
    })
})
