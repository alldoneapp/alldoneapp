import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2453 — the routing badge belongs in the row's TRAILING tag area, never in the leading slot in
 * front of the task title.
 *
 * Two halves, and only the first one is where a regression would actually land. `TaskRoutingTag`
 * itself is placement-agnostic — it renders the same pill wherever it is mounted — so a suite that
 * only rendered the tag could not tell the two positions apart and would stay green through a
 * revert. What decides the position is the WIRING in `TaskPresentation`: which of
 * `leadingVmStatusTag` / `trailingRoutingTag` the badge is built into, and which container that
 * prop is handed to. That is asserted here through the real row.
 *
 * The second half asserts the containers place it where the summary chip cannot reach it. The
 * trailing tags collapse into a single `TaskSummarizeTags` chip on crowded rows and on mobile
 * (`shouldSummarizeTaskTags`), so a badge rendered as one more entry in `TagsArea/Tags.js` would
 * disappear exactly when the row is busy — visible on a quiet desktop row, invisible on the phone
 * where new tasks are actually captured. Being a SIBLING of `TaskItemTags` is what prevents that,
 * and it is not observable from the tag component alone either.
 */

let mockRoutingActivity = { processing: null, confirmation: null }
let mockInMyDay = false

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
    return { __esModule: true, default: React.forwardRef(({ children }, _ref) => children) }
})
jest.mock('./TaskFileDropZone', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('./taskFileDropHelper', () => ({ canDropFilesOnTaskRow: () => false }))
jest.mock('./TaskRoutingActivityOverlay', () => 'TaskRoutingActivityOverlay')
jest.mock('./useTaskRoutingActivity', () => ({
    __esModule: true,
    default: () => mockRoutingActivity,
}))
jest.mock('./taskAiStepControl', () => ({ shouldShowAiStepControl: () => false }))
// Mocked for the row-level wiring assertions, which only read the props these receive. The
// container-level block below reaches past this with `jest.requireActual`.
jest.mock('./TaskTagsContainer', () => 'TaskTagsContainer')
jest.mock('./TaskTagsContainerByTime', () => 'TaskTagsContainerByTime')
jest.mock('../../TaskItemTags', () => 'TaskItemTags')
jest.mock('../../TagsArea/Tags', () => 'Tags')
jest.mock('../../../Tags/TimeTagWrapper', () => 'TimeTagWrapper')
jest.mock('../../../Tags/CompletedTimeTag', () => 'CompletedTimeTag')
jest.mock('../../../Tags/CalendarTag', () => 'CalendarTag')
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
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false, getProjectNameById: () => 'Alldone Product' },
}))
jest.mock('../../../Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
jest.mock('../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    checkIfInMyDay: () => mockInMyDay,
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
    shouldOnPressInput: () => true,
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
    // Awaited because `useReducedMotion` and the tag-width measurement each settle a microtask deep.
    await act(async () => {
        tree = renderer.create(<TaskPresentation projectId={'project-1'} task={baseTask} />)
        await Promise.resolve()
        await Promise.resolve()
    })
    return tree
}

/** Renders an element built by `TaskPresentation` on its own so its contents can be inspected. */
const contains = (element, type) => {
    if (!element) return false
    const tree = renderer.create(element)
    const found = tree.root.findAllByType(type).length > 0
    tree.unmount()
    return found
}

describe('routing badge placement (AT-2453)', () => {
    beforeEach(() => {
        mockRoutingActivity = { processing: null, confirmation: null }
        mockInMyDay = false
    })

    describe('the real row decides the position', () => {
        it('hands the badge to the trailing tag area and keeps it out of the leading slot', async () => {
            mockRoutingActivity = { processing: { subject: 'project' }, confirmation: null }

            const tree = await renderRow()
            const tags = tree.root.findByType('TaskTagsContainer')
            const title = tree.root.findByType('TitleContainer')

            expect(contains(tags.props.trailingRoutingTag, 'TaskRoutingTag')).toBe(true)
            // The regression this whole suite exists for: the badge used to be built into
            // `leadingVmStatusTag`, which renders in front of the task name.
            expect(contains(title.props.leadingVmStatusTag, 'TaskRoutingTag')).toBe(false)
            expect(contains(title.props.leftCustomElement, 'TaskRoutingTag')).toBe(false)
        })

        it('moves the confirmation badge too, not only the processing sparkle', async () => {
            mockRoutingActivity = {
                processing: null,
                confirmation: { subject: 'project', fromProjectId: 'project-2' },
            }

            const tree = await renderRow()
            const tags = tree.root.findByType('TaskTagsContainer')
            const title = tree.root.findByType('TitleContainer')

            expect(contains(tags.props.trailingRoutingTag, 'TaskRoutingTag')).toBe(true)
            expect(contains(title.props.leadingVmStatusTag, 'TaskRoutingTag')).toBe(false)
        })

        it('passes the routing state and the project name through unchanged', async () => {
            const confirmation = { subject: 'goal', goalId: 'goal-1' }
            mockRoutingActivity = { processing: null, confirmation }

            const tree = await renderRow()
            const badge = tree.root.findByType('TaskTagsContainer').props.trailingRoutingTag

            expect(badge.props.processing).toBeNull()
            expect(badge.props.confirmation).toBe(confirmation)
            expect(badge.props.projectName).toBe('Alldone Product')
            // Trailing tags space themselves from the left; the leading slot spaced from the right.
            expect(badge.props.style).toEqual({ marginLeft: 8 })
        })

        it('mounts nothing at all for the overwhelming majority of rows', async () => {
            const tree = await renderRow()

            expect(tree.root.findByType('TaskTagsContainer').props.trailingRoutingTag).toBeNull()
            expect(tree.root.findAllByType('TaskRoutingTag')).toHaveLength(0)
        })

        it('uses the trailing tag area in the My Day by-time layout too', async () => {
            mockInMyDay = true
            mockRoutingActivity = { processing: { subject: 'goal' }, confirmation: null }

            const tree = await renderRow()
            const tags = tree.root.findByType('TaskTagsContainerByTime')
            const title = tree.root.findByType('TitleContainer')

            expect(contains(tags.props.trailingRoutingTag, 'TaskRoutingTag')).toBe(true)
            // In by-time the leading tag is rendered in the tag row's LEFT area, beside the time and
            // priority chips — still the wrong side of the row for this badge.
            expect(contains(tags.props.leadingVmStatusTag, 'TaskRoutingTag')).toBe(false)
            // `TaskPresentation` hands the same element to `TitleContainer` in every layout and lets
            // it decide (it drops the leading slot in by-time); the badge must be absent either way.
            expect(contains(title.props.leadingVmStatusTag, 'TaskRoutingTag')).toBe(false)
        })

        it('leaves the VM and workflow tags in the leading slot', async () => {
            mockRoutingActivity = { processing: { subject: 'project' }, confirmation: null }

            const tree = await renderRow()
            const leading = tree.root.findByType('TitleContainer').props.leadingVmStatusTag

            expect(contains(leading, 'TaskVmStatusTag')).toBe(true)
            expect(contains(leading, 'AssistantWorkflowRunTag')).toBe(true)
        })
    })

    describe('the containers put it where the summary chip cannot hide it', () => {
        // Required by both containers, and irrelevant to placement.
        const containerProps = {
            task: { id: 'task-1', isSubtask: false },
            projectId: 'project-1',
            highlightColor: '#FFFFFF',
            setTagsExpandedHeight: jest.fn(),
        }

        it('leads the measured trailing tag row in the regular layout', () => {
            const TaskTagsContainer = jest.requireActual('./TaskTagsContainer').default
            const routingTag = <Text>routing</Text>
            const tree = renderer.create(<TaskTagsContainer {...containerProps} trailingRoutingTag={routingTag} />)

            // Depth-first, so this is render order: the badge leads the tags.
            const ordered = tree.root.findAll(node => node.type === Text || node.type === 'TaskItemTags')
            expect(ordered.map(node => (node.type === Text ? 'routing' : 'tags'))).toEqual(['routing', 'tags'])

            // A SIBLING of `TaskItemTags`, not one of its tags. `shouldSummarizeTaskTags` collapses
            // everything inside that component into a single chip, so anything handed to it can be
            // hidden exactly when the row is crowded.
            expect(Object.values(tree.root.findByType('TaskItemTags').props)).not.toContain(routingTag)

            // Inside the measured `social_tags_…` node, so `showWrappedTaskEllipsis` and
            // `doTrailingTagsCrowdTaskTitle` can see its width and truncate the title around it
            // rather than letting it silently overlap.
            const tagRow = tree.root.findAllByProps({ nativeID: 'social_tags_project-1_task-1' })[0]
            expect(tagRow.findAllByType(Text)).toHaveLength(1)
        })

        it('renders nothing extra when there is no routing activity', () => {
            const TaskTagsContainer = jest.requireActual('./TaskTagsContainer').default
            const tree = renderer.create(<TaskTagsContainer {...containerProps} trailingRoutingTag={null} />)

            expect(tree.root.findAllByType(Text)).toHaveLength(0)
        })

        it('leads the right-hand tags in the by-time layout, not the left area', () => {
            const TaskTagsContainerByTime = jest.requireActual('./TaskTagsContainerByTime').default
            const tree = renderer.create(
                <TaskTagsContainerByTime
                    {...containerProps}
                    task={{ id: 'task-1' }}
                    leadingVmStatusTag={<Text>vm</Text>}
                    leadingPriorityTag={<Text>priority</Text>}
                    trailingRoutingTag={<Text>routing</Text>}
                />
            )

            const rendered = tree.root.findAllByType(Text).map(node => node.props.children)
            // The left area comes first in the row, so the badge trailing `priority` is the
            // assertion that it sits in the right-hand tag group.
            expect(rendered).toEqual(['vm', 'priority', 'routing'])

            const rightArea = tree.root.findByType('TaskItemTags').parent
            expect(rightArea.findAllByType(Text)).toHaveLength(1)
        })
    })
})
