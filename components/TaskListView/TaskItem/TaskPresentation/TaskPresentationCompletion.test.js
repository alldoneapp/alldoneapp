import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2404 — the subtask guarantee, asserted end to end through the REAL row.
 *
 * `taskCompletionMotion.test.js` pins the rule and the hook in isolation. This suite exists because
 * the bug it is guarding against was never in the rule: it was in the WIRING. `TaskPresentation` is
 * the single row implementation behind every context that renders a task line, and it decides — on
 * behalf of all of them — whether the row it is drawing is allowed to collapse. A future change
 * that threads `retainRow` from the wrong place, or drops it, would leave every unit test green and
 * put an invisible zero-height row back into the subtask lists.
 *
 * So the checkbox is pressed for real, through the real `CheckBoxWrapper`, and the assertion is
 * made on the outermost row node's actual style. Everything that is not on that path is mocked away
 * — this is about the row, not about tags, swipes or file drops.
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
jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    // forwardRef because TaskPresentation keeps a ref on it to close the swipe programmatically.
    return { __esModule: true, default: React.forwardRef(({ children }, _ref) => children) }
})
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

import fs from 'fs'
import path from 'path'

import TaskPresentation from './TaskPresentation'
import TaskCompletionCelebration from './CheckBoxContainer/TaskCompletionCelebration'
import { moveTasksFromOpen, setTaskStatus } from '../../../../utils/backends/Tasks/tasksFirestore'
import { COMPLETION_HOLD_MS, RETAINED_HOLD_MS } from './taskCompletionMotion'

const ROW_HEIGHT = 48

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

const findRow = tree => tree.root.findAllByProps({ testID: 'task-completion-row' }, { deep: false })[0]
const rowStyle = tree => Object.assign({}, ...[].concat(findRow(tree).props.style).filter(Boolean))

const renderRow = async (task, props) => {
    const ref = React.createRef()
    let tree
    // Awaited because `useReducedMotion` resolves its preference asynchronously on mount.
    await act(async () => {
        tree = renderer.create(<TaskPresentation ref={ref} projectId={'project-1'} task={task} {...props} />)
        // Twice: `useReducedMotion` and the tag-width measurement each settle a microtask deep.
        await Promise.resolve()
        await Promise.resolve()
    })
    // A row that has never been laid out cannot collapse at all, so the measurement has to be in
    // place before the press or the top-level case would pass for the wrong reason.
    act(() => findRow(tree).props.onLayout({ nativeEvent: { layout: { height: ROW_HEIGHT } } }))
    return { tree, ref }
}

const tickCheckbox = ref => act(() => ref.current.onCheckboxPress())

describe('TaskPresentation completion (AT-2404)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    let consoleLogSpy

    beforeEach(() => {
        jest.useFakeTimers()
        // CheckBoxWrapper logs every press under __DEV__.
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        // The motion is inert under jest by convention, and an inert row never collapses — which
        // would make every assertion here pass vacuously.
        process.env.NODE_ENV = 'development'
        moveTasksFromOpen.mockClear()
        setTaskStatus.mockClear()
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    it('leaves an ordinary row untouched until it is completed', async () => {
        const { tree } = await renderRow(baseTask)

        // No stale measured height on a row nobody has ticked.
        expect(rowStyle(tree).height).toBeUndefined()
        expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(0)
    })

    describe('a top-level task', () => {
        it('collapses out of the list and holds its write behind the animation', async () => {
            const { tree, ref } = await renderRow(baseTask)

            tickCheckbox(ref)

            const style = rowStyle(tree)
            expect(style.overflow).toBe('hidden')
            expect(style.height.__getValue()).toBe(ROW_HEIGHT)
            expect(moveTasksFromOpen).not.toHaveBeenCalled()

            await act(async () => {
                jest.advanceTimersByTime(COMPLETION_HOLD_MS)
                await Promise.resolve()
            })
            expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        })

        it('celebrates at the checkbox', async () => {
            const { tree, ref } = await renderRow(baseTask)

            tickCheckbox(ref)

            expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(1)
            expect(tree.root.findByType('TitleContainer').props.completionStrike).not.toBeNull()
        })
    })

    describe.each([
        // Every subtask list in the app renders this same component with the subtask document, so
        // the flag on the document is what has to be honoured — there is no per-context prop and no
        // second row implementation to keep in step.
        ['the inline subtask list and the TDV Subtasks tab', { isSubtask: true, parentId: 'parent-1' }, {}],
        ['a legacy subtask document carrying only a parent id', { parentId: 'parent-1' }, {}],
        ['the comment popup header', {}, { inCommentPopup: true }],
    ])('a row that stays in its list — %s', (_description, taskOverrides, props) => {
        const task = () => ({ ...baseTask, ...taskOverrides })

        it('never collapses', async () => {
            const { tree, ref } = await renderRow(task(), props)

            tickCheckbox(ref)

            // The bug this replaces: the row animated its height to 0 and nothing ever put it back,
            // because no query removes a completed subtask. It looked deleted and was still there.
            const style = rowStyle(tree)
            expect(style.height).toBeUndefined()
            expect(style.overflow).toBeUndefined()
            expect(style.opacity).toBeUndefined()

            await act(async () => {
                jest.advanceTimersByTime(COMPLETION_HOLD_MS * 3)
                await Promise.resolve()
            })
            // And it is still not collapsed once every timer in the sequence has run out.
            expect(rowStyle(tree).height).toBeUndefined()
        })

        it('still gets the completion feedback', async () => {
            const { tree, ref } = await renderRow(task(), props)

            tickCheckbox(ref)

            expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(1)
            expect(tree.root.findByType('TitleContainer').props.completionStrike).not.toBeNull()
        })

        it('clears the flourish again once the sequence is over', async () => {
            const { tree, ref } = await renderRow(task(), props)

            tickCheckbox(ref)
            await act(async () => {
                jest.advanceTimersByTime(COMPLETION_HOLD_MS * 3)
                await Promise.resolve()
            })

            // What is left is the ordinary done row — the same thing a reload renders.
            expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(0)
            expect(tree.root.findByType('TitleContainer').props.completionStrike).toBeNull()
        })
    })

    describe('reopening a completed subtask', () => {
        const subtask = { ...baseTask, isSubtask: true, parentId: 'parent-1' }

        it('resets every trace of the completion', async () => {
            const { tree, ref } = await renderRow(subtask)

            tickCheckbox(ref)
            expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(1)

            // The write lands: the subtask is done, and still exactly where it was.
            await act(async () => {
                jest.advanceTimersByTime(RETAINED_HOLD_MS)
                await Promise.resolve()
                tree.update(<TaskPresentation ref={ref} projectId={'project-1'} task={{ ...subtask, done: true }} />)
                await Promise.resolve()
                await Promise.resolve()
            })
            // ...and the user unchecks it again, before the release timer had a chance to run.
            await act(async () => {
                tree.update(<TaskPresentation ref={ref} projectId={'project-1'} task={{ ...subtask, done: false }} />)
                await Promise.resolve()
                await Promise.resolve()
            })

            expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(0)
            expect(tree.root.findByType('TitleContainer').props.completionStrike).toBeNull()
            expect(rowStyle(tree).height).toBeUndefined()
        })

        it('writes the reopen directly, with no animation to wait for', async () => {
            const { ref } = await renderRow({ ...subtask, done: true })

            tickCheckbox(ref)
            await act(async () => {
                await Promise.resolve()
            })

            // Un-completing has never been animated and must not start being: the row is not
            // going anywhere and the user is undoing, not celebrating.
            expect(setTaskStatus).toHaveBeenCalledTimes(1)
            expect(setTaskStatus.mock.calls[0][2]).toBe(false)
        })
    })
})

/**
 * A source-level ratchet, in the style of `__tests__/ModalSystemGuardrails.test.js`.
 *
 * Everything above proves the row behaves. This proves there is only ONE row: the subtask
 * guarantee is worth exactly as much as the claim that every subtask context goes through
 * `TaskPresentation`, and that claim is the thing a future change can quietly break — by adding a
 * second row component with its own checkbox, or by calling the motion hook somewhere that has no
 * idea what a subtask is.
 */
describe('the completion motion has one owner (AT-2404)', () => {
    const COMPONENTS_ROOT = path.resolve(__dirname, '../../../..', 'components')
    const HOOK_CALL = 'useTaskCompletionMotion('

    const walk = dir =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) return walk(full)
            return entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [full] : []
        })

    const sources = walk(COMPONENTS_ROOT).map(file => ({
        file: path.relative(COMPONENTS_ROOT, file),
        source: fs.readFileSync(file, 'utf8'),
    }))

    it('is called from TaskPresentation and nowhere else', () => {
        const callers = sources
            .filter(({ source }) => source.includes(HOOK_CALL))
            .map(({ file }) => file)
            .filter(file => !file.endsWith('taskCompletionMotion.js'))

        expect(callers).toEqual(['TaskListView/TaskItem/TaskPresentation/TaskPresentation.js'])
    })

    it('resolves retainRow from the shared rule rather than inline', () => {
        const { source } = sources.find(entry =>
            entry.file.endsWith('TaskListView/TaskItem/TaskPresentation/TaskPresentation.js')
        )

        // Inlining `task.isSubtask` here would work today and drift the moment the rule grows a
        // case — `parentId`, the comment popup, whatever comes next.
        expect(source).toContain('rowRemainsAfterCompletion(task, { inCommentPopup })')
        expect(source).toContain('useTaskCompletionMotion({ retainRow')
    })

    it('leaves the completable checkbox with a single host', () => {
        const hosts = sources
            .filter(({ source }) => /from '.*CheckBoxContainer\/CheckBoxWrapper'/.test(source))
            .map(({ file }) => file)

        // A second row component wiring up its own CheckBoxWrapper is how a subtask context could
        // start completing tasks without ever reaching the rule above.
        expect(hosts).toEqual(['TaskListView/TaskItem/TaskPresentation/TaskPresentation.js'])
    })
})
