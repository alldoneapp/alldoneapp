import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import store from '../../../../redux/store'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem, setSwipeDueDatePopupData, showSwipeDueDatePopup } from '../../../../redux/actions'
import MyPlatform from '../../../MyPlatform'
import TasksHelper, { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../Utils/TasksHelper'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import SharedHelper from '../../../../utils/SharedHelper'
import GmailTag from '../../../Tags/GmailTag'
import SwipeAreasContainer from '../../SwipeAreasContainer'
import ShortcutsArea from './ShortcutsArea/ShortcutsArea'
import SixDotsContainer from '../../SixDotsContainer'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_TASK_PROPERTIES } from '../../../../utils/TabNavigationConstants'
import { objectIsLockedForUser } from '../../../Guides/guidesHelper'
import LineOfTime from '../../LineOfTime'
import { isInboxSummaryGmailTask } from '../../../../utils/Gmail/gmailTaskUtils'
import {
    checkIfInMyDay,
    checkIfInMyDayOpenTab,
} from '../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import useLastAddedTaskColor from '../../useLastAddedTaskColor'
import useGetTaskWorkflow from '../../../../utils/useGetTaskWorkflow'
import CheckBoxWrapper from './CheckBoxContainer/CheckBoxWrapper'
import TitleContainer from './TitleContainer/TitleContainer'
import AlertTag from '../../../Tags/AlertTag'
import TranscribeTag from '../../../Tags/TranscribeTag'
import TaskTagsContainerByTime from './TaskTagsContainerByTime'
import TaskTagsContainer from './TaskTagsContainer'
import TaskPriorityTagButton from '../../TaskPriorityTagButton'
import TaskVmStatusTag from '../../../Tags/InProgressVmTag'
import { doTrailingTagsCrowdTaskTitle } from '../../TagsArea/taskTagSummaryHelper'
import { shouldShowAiStepControl } from './taskAiStepControl'
import CommentPopupWorkflowControls from '../../../UIComponents/FloatModals/RichCommentModal/CommentPopupWorkflowControls'
import AssistantWorkflowRunTag from '../../../Tags/AssistantWorkflowRunTag'
import { taskPresentationLayout } from './TaskPresentationLayout'
import TaskFileDropZone from './TaskFileDropZone'
import { canDropFilesOnTaskRow } from './taskFileDropHelper'
import TaskRoutingTag from '../../../Tags/TaskRoutingTag'
import TaskRoutingActivityOverlay from './TaskRoutingActivityOverlay'
import useTaskRoutingActivity from './useTaskRoutingActivity'
import useTaskCompletionMotion, { rowRemainsAfterCompletion } from './taskCompletionMotion'

function TaskPresentation(
    {
        task,
        projectId,
        isObservedTask,
        isToReviewTask,
        toggleModal,
        toggleSubTaskList,
        subtaskList,
        isSuggested,
        isActiveOrganizeMode,
        checkOnDrag,
        inParentGoal,
        isPending,
        inCommentPopup,
        onCommentPopupWorkflowTransitionSuccess,
    },
    ref
) {
    const dispatch = useDispatch()
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const rawInFocusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const optimisticFocusTaskId = useSelector(state => state.optimisticFocusTaskId)
    const optimisticFocusActive = useSelector(state => state.optimisticFocusActive)
    const inFocusTaskId = optimisticFocusActive ? optimisticFocusTaskId : rawInFocusTaskId
    const activeTaskId = useSelector(state => state.loggedUser.activeTaskId)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const userProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const activeEditMode = useSelector(state => state.activeEditMode)
    const lastTaskAddedId = useSelector(state => state.lastTaskAddedId)

    const [forceTagsMobile, setForceTagsMobile] = useState(false)

    const [taskItemWidth, setTaskItemWidth] = useState(0)
    const [taskTagsWidth, setTaskTagsWidth] = useState(0)
    const [taskTitleIsMultiline, setTaskTitleIsMultiline] = useState(false)
    const [blockOpen, setBlockOpen] = useState(false)
    const [tagsExpandedHeight, setTagsExpandedHeight] = useState(0)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const itemSwipe = useRef()
    const taskTagsSection = useRef()
    const checkBoxRef = useRef(null)

    const workflow = useGetTaskWorkflow(projectId, task)

    const inMyDay = checkIfInMyDay(
        selectedProjectIndex,
        showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    const inMyDayAndNotSubtask = inMyDay && !task.isSubtask

    const trailingTagsCrowdTitle = doTrailingTagsCrowdTaskTitle({
        taskTagsWidth,
        taskItemWidth,
        taskTitleIsMultiline,
        inMyDayAndNotSubtask,
    })

    const hasStar = task.hasStar.toUpperCase() === '#FFFFFF' && inMyDayAndNotSubtask ? colors.Grey500 : task.hasStar

    const lastAddedTaskBackgroundColor = useLastAddedTaskColor(task.id, lastTaskAddedId, hasStar)

    // AT-2381 — "the server is still deciding where this task belongs", and the one-shot
    // confirmation when that decision actually changed the task. Null for the overwhelming
    // majority of rows; the badge and the motion layer are mounted only when it is not, so a
    // long list pays nothing for a feature that concerns a handful of freshly created tasks.
    const { processing: routingProcessing, confirmation: routingConfirmation } = useTaskRoutingActivity(task, projectId)
    const hasRoutingActivity = !!(routingProcessing || routingConfirmation)

    /**
     * AT-2404 — the checkbox burst, strike-through, green wash and exit this row plays when it is
     * checked off. The state lives here because the effect is the whole row's, but it is TRIGGERED
     * from `CheckBoxWrapper` below, which is handed `beginCompletionMotion` and told how long to
     * hold its write.
     *
     * `retainRow` is the subtask guarantee, and it is resolved HERE — from the task, through the
     * shared `rowRemainsAfterCompletion` rule — rather than at the checkbox, because
     * `TaskPresentation` is the ONE row implementation behind every context that renders a task
     * line: open lists, MyDay, Goal DV, pending, done, backlinks, drag mode, the inline subtask
     * list under a row, the TDV Subtasks tab and the comment popup header. A rule expressed here
     * cannot be forgotten by one of them. See the function for why a subtask is the case that
     * matters.
     */
    const retainRow = rowRemainsAfterCompletion(task, { inCommentPopup })
    const {
        onRowLayout: onCompletionRowLayout,
        rowStyle: completionRowStyle,
        beginCompletionMotion,
        cancelCompletionMotion,
        completionStrike,
        completionWash,
        completionCelebration,
        isCompleting,
    } = useTaskCompletionMotion({ retainRow, isDone: task.done })

    const inMyDayOpenTab = checkIfInMyDayOpenTab(
        selectedProjectIndex,
        showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    const isActiveTask = activeTaskId === task.id

    const hasWorkflow = workflow && Object.keys(workflow).length > 0
    const showWorkflowIndicator = hasWorkflow && task.done === false && !task.parentId

    // Task placement logic - workflow tasks assigned to others go to pending section
    const pending =
        task.userIds?.length > 1 &&
        (task.userIds?.[task.userIds?.length - 1] !== currentUserId || route === 'GoalDetailedView') &&
        task.done === false &&
        !task.parentId

    const showAiStepControl = shouldShowAiStepControl({
        workflow,
        task,
        showWorkflowIndicator,
        pending,
        isObservedTask,
        isSuggested,
    })

    useImperativeHandle(ref, () => ({
        onCheckboxPress: () => {
            checkBoxRef.current?.onCheckboxPress(pending || isSuggested || isObservedTask || isToReviewTask)
        },
    }))

    // Swipeable calls renderLeftActions during its own render, so adopting its dragX node here
    // synchronously would set state on this component while another one renders (React warns and
    // the update is not batched with the current pass). dragX is stable per Swipeable instance,
    // so deferring the swap by a microtask adopts it just as reliably, one render later.
    const renderLeftSwipe = (progress, dragX) => {
        if (panColor !== dragX) {
            Promise.resolve().then(() => setPanColor(dragX))
        }
        return <View style={{ width: 150 }} />
    }

    const renderRightSwipe = (progress, dragX) => {
        return !task.done && <View style={{ width: 150 }} />
    }

    const onLeftSwipe = () => {
        itemSwipe.current.close()
        NavigationService.navigate('TaskDetailedView', {
            task: task,
            projectId: projectId,
        })
        dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
    }

    const onRightSwipe = () => {
        itemSwipe.current.close()
        dismissAllPopups()
        store.dispatch([
            showSwipeDueDatePopup(),
            setSwipeDueDatePopupData({
                projectId: projectId,
                task: task,
                isObservedTask,
                isToReviewTask,
            }),
        ])
    }

    useEffect(() => {
        let isMounted = true

        MyPlatform.getElementWidth(taskTagsSection.current).then(taskTagsWidth => {
            if (isMounted) {
                setTaskTagsWidth(taskTagsWidth)
            }
        })

        return () => {
            isMounted = false
        }
    }, [task])

    const onLayoutChange = layout => {
        let taskItemWidth = layout.nativeEvent.layout.width
        if (taskTagsWidth >= taskItemWidth && !forceTagsMobile) {
            setForceTagsMobile(true)
        } else if (taskTagsWidth < taskItemWidth && forceTagsMobile) {
            setForceTagsMobile(false)
        }

        setTaskItemWidth(taskItemWidth)
    }

    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, userProjectIds, projectId, false)
    const anonymousGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, userProjectIds, projectId, true)

    const restingBackgroundColor = inCommentPopup ? colors.Secondary200 : task.isSubtask ? colors.Grey200 : '#ffffff'

    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, restingBackgroundColor, colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    const backColorHighlight = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, hasStar, colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    const highlightColor = inCommentPopup
        ? backColor
        : lastTaskAddedId === task.id
          ? lastAddedTaskBackgroundColor
          : hasStar.toLowerCase() !== '#ffffff'
            ? backColorHighlight
            : backColor

    const showVerticalEllipsis = inMyDayAndNotSubtask
        ? TasksHelper.showWrappedTaskEllipsisInByTime(
              `social_text_container_${projectId}_${task.id}_${isObservedTask}`,
              taskItemWidth
          )
        : TasksHelper.showWrappedTaskEllipsis(
              `social_tags_${projectId}_${task.id}`,
              `social_text_${projectId}_${task.id}_${isObservedTask}`
          )

    const loggedUserIsTaskOwner = loggedUserId === task.userId
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, task.lockKey, task.userId)

    // AT-2363: dropping a file on the row appends it to the task description.
    const fileDropAllowed = canDropFilesOnTaskRow({
        accessGranted,
        loggedUserCanUpdateObject,
        isCalendarTask: !!task.calendarData,
        isAssistantTask: task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE,
        isLocked,
        isActiveOrganizeMode,
        isSuggested,
        inCommentPopup,
    })

    // Priority chip is now shown at the START of the task row (like a calendar task's time) instead
    // of in the trailing tags. Built once here so the regular view (in the title via leftCustomElement)
    // and the My Day by-time view (in the left time area) share the same clickable element + disabled
    // rule. Renders null for tasks without a priority.
    const priorityTagDisabled = isActiveOrganizeMode || isLocked || !accessGranted || isSuggested || isPending
    const leadingPriorityTag = (
        <TaskPriorityTagButton
            task={task}
            projectId={projectId}
            disabled={priorityTagDisabled}
            style={{ marginRight: 8 }}
        />
    )
    const leadingVmStatusTag = (
        <>
            <AssistantWorkflowRunTag projectId={projectId} task={task} />
            <TaskVmStatusTag projectId={projectId} taskId={task.id} style={{ marginRight: 8 }} />
            {hasRoutingActivity && (
                <TaskRoutingTag
                    processing={routingProcessing}
                    confirmation={routingConfirmation}
                    projectName={ProjectHelper.getProjectNameById(projectId, '')}
                    style={{ marginRight: 8 }}
                />
            )}
        </>
    )

    return (
        <TaskFileDropZone disabled={!fileDropAllowed} projectId={projectId} task={task}>
            {/* AT-2404 — the node that collapses on completion. It has to be the OUTERMOST row
                element so the height that animates to 0 is the whole row (swipe areas, shortcuts
                and all); collapsing anything inner would leave its wrapper holding the space open
                and the list would not close the gap. `completionRowStyle` is undefined except
                during those ~260ms, so an ordinary row is never pinned to a measured height. */}
            <Animated.View
                style={[isLocked && !inParentGoal && localStyles.blurry, completionRowStyle]}
                onLayout={onCompletionRowLayout}
                testID="task-completion-row"
            >
                <SwipeAreasContainer
                    leftText={'Properties'}
                    rightText={'Reminder'}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
                <Swipeable
                    useNativeAnimations={false}
                    ref={itemSwipe}
                    rightThreshold={80}
                    leftThreshold={80}
                    enabled={
                        !inCommentPopup &&
                        !activeEditMode &&
                        !isActiveOrganizeMode &&
                        !isLocked &&
                        anonymousGranted &&
                        // A row that is collapsing must not also be swipeable — the gesture would
                        // fight the height animation and could open a reminder popup for a task
                        // that is already on its way out.
                        !isCompleting
                    }
                    renderLeftActions={renderLeftSwipe}
                    renderRightActions={accessGranted && renderRightSwipe}
                    onSwipeableLeftWillOpen={onLeftSwipe}
                    onSwipeableRightWillOpen={loggedUserCanUpdateObject && accessGranted && onRightSwipe}
                    overshootLeft={false}
                    overshootRight={false}
                    friction={2}
                    containerStyle={{ overflow: 'visible' }}
                    failOffsetY={[-5, 5]}
                    onSwipeableWillClose={() => {
                        setBlockOpen(true)
                    }}
                    onSwipeableClose={() => {
                        setBlockOpen(false)
                    }}
                >
                    <View style={taskPresentationLayout.container}>
                        <View style={{ borderRadius: 4 }}>
                            <Animated.View
                                style={[
                                    !isActiveOrganizeMode &&
                                        inFocusTaskId === task.id && { borderColor: colors.Primary100, borderWidth: 2 },
                                    taskPresentationLayout.taskRow,
                                    task.isSubtask ? subTaskStyles.taskRow : undefined,
                                    task.isSubtask ? { paddingLeft: 2 } : undefined,
                                    isActiveOrganizeMode &&
                                        (task.isSubtask
                                            ? subTaskStyles.dragModeContainer
                                            : localStyles.dragModeContainer),
                                    { backgroundColor: highlightColor },
                                ]}
                                onLayout={onLayoutChange}
                                nativeID={`task_body_${projectId}_${task.id}_${isObservedTask}`}
                            >
                                {/* AT-2381 — decoration only, and deliberately a sibling rather than
                                    a wrapper: it fills the row absolutely with `pointerEvents="none"`,
                                    so it can never change the row's height or swallow a tap. The task
                                    stays completable, draggable and editable while it sparkles. */}
                                {hasRoutingActivity && (
                                    <TaskRoutingActivityOverlay
                                        processing={routingProcessing}
                                        confirmation={routingConfirmation}
                                    />
                                )}
                                {/* AT-2404 — the green wash, and the reason it SWEEPS rather than
                                    fades: it scales on X from the same `Animated.Value` and the
                                    same left origin as the strike-through, so its leading edge is
                                    the strike's head. One value, one gesture — the colour arrives
                                    across the row exactly as fast as the line is drawn, which is
                                    what makes them read as a single event instead of two
                                    animations that happen to overlap. Rendered only when the task
                                    is genuinely completed, so a workflow step advance (which also
                                    leaves this list) does not get the colour that means "done". */}
                                {completionWash && (
                                    <Animated.View
                                        style={[
                                            localStyles.completionTint,
                                            {
                                                opacity: completionWash.opacity.interpolate({
                                                    inputRange: [0, 1],
                                                    outputRange: [0, COMPLETION_TINT_PEAK_OPACITY],
                                                }),
                                                transform: [{ scaleX: completionWash.progress }],
                                            },
                                        ]}
                                        pointerEvents="none"
                                        testID="task-completion-tint"
                                    />
                                )}
                                <View
                                    pointerEvents={isActiveOrganizeMode || isLocked ? 'none' : 'auto'}
                                    style={[
                                        taskPresentationLayout.leadingContent,
                                        !inMyDayAndNotSubtask && { paddingBottom: tagsExpandedHeight },
                                    ]}
                                >
                                    <CheckBoxWrapper
                                        ref={checkBoxRef}
                                        task={task}
                                        projectId={projectId}
                                        isObservedTask={isObservedTask}
                                        isToReviewTask={isToReviewTask}
                                        isSuggested={isSuggested}
                                        isActiveOrganizeMode={isActiveOrganizeMode}
                                        checkOnDrag={checkOnDrag}
                                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                                        highlightColor={highlightColor}
                                        accessGranted={accessGranted}
                                        pending={pending}
                                        showWorkflowIndicator={showWorkflowIndicator}
                                        isNextStepAi={showAiStepControl}
                                        beginCompletionMotion={beginCompletionMotion}
                                        cancelCompletionMotion={cancelCompletionMotion}
                                        completionCelebration={completionCelebration}
                                    />
                                    {!inMyDayAndNotSubtask && isInboxSummaryGmailTask(task) && (
                                        <GmailTag
                                            gmailData={task.gmailData}
                                            propStyles={{ marginTop: 8, marginLeft: 12 }}
                                        />
                                    )}
                                    {!inMyDayAndNotSubtask && task?.alertEnabled && (
                                        <>
                                            {task.calendarData ? (
                                                <TranscribeTag
                                                    task={task}
                                                    projectId={projectId}
                                                    containerStyle={{ marginTop: 8, marginLeft: 12, marginRight: 0 }}
                                                />
                                            ) : (
                                                <AlertTag
                                                    task={task}
                                                    containerStyle={{ marginTop: 8, marginLeft: 12, marginRight: 0 }}
                                                    onPress={onLeftSwipe}
                                                />
                                            )}
                                        </>
                                    )}
                                    <TitleContainer
                                        task={task}
                                        projectId={projectId}
                                        isObservedTask={isObservedTask}
                                        toggleModal={toggleModal}
                                        backColorHighlight={backColorHighlight}
                                        backColor={backColor}
                                        hasStar={hasStar}
                                        inMyDayAndNotSubtask={inMyDayAndNotSubtask}
                                        blockOpen={blockOpen}
                                        tagsExpandedHeight={tagsExpandedHeight}
                                        showVerticalEllipsisInByTime={inMyDayAndNotSubtask && showVerticalEllipsis}
                                        leadingVmStatusTag={leadingVmStatusTag}
                                        leadingPriorityTag={leadingPriorityTag}
                                        useCommentPopupTextColor={inCommentPopup}
                                        setTaskTitleIsMultiline={setTaskTitleIsMultiline}
                                        completionStrike={completionStrike}
                                    />
                                </View>
                                {inMyDayAndNotSubtask && (
                                    <TaskTagsContainerByTime
                                        task={task}
                                        projectId={projectId}
                                        isObservedTask={isObservedTask}
                                        isToReviewTask={isToReviewTask}
                                        toggleSubTaskList={toggleSubTaskList}
                                        subtaskList={subtaskList}
                                        isSuggested={isSuggested}
                                        isActiveOrganizeMode={isActiveOrganizeMode}
                                        isPending={isPending}
                                        isLocked={isLocked}
                                        highlightColor={highlightColor}
                                        anonymousGranted={anonymousGranted}
                                        accessGranted={accessGranted}
                                        taskTagsSection={taskTagsSection}
                                        forceTagsMobile={forceTagsMobile}
                                        setTagsExpandedHeight={setTagsExpandedHeight}
                                        toggleModal={toggleModal}
                                        blockOpen={blockOpen}
                                        onAlertTagPress={onLeftSwipe}
                                        leadingVmStatusTag={leadingVmStatusTag}
                                        leadingPriorityTag={leadingPriorityTag}
                                        inCommentPopup={inCommentPopup}
                                    />
                                )}
                                {!inMyDayAndNotSubtask && (
                                    <TaskTagsContainer
                                        task={task}
                                        projectId={projectId}
                                        isObservedTask={isObservedTask}
                                        isToReviewTask={isToReviewTask}
                                        toggleSubTaskList={toggleSubTaskList}
                                        subtaskList={subtaskList}
                                        isSuggested={isSuggested}
                                        isActiveOrganizeMode={isActiveOrganizeMode}
                                        isPending={isPending}
                                        isLocked={isLocked}
                                        showVerticalEllipsis={showVerticalEllipsis}
                                        highlightColor={highlightColor}
                                        anonymousGranted={anonymousGranted}
                                        accessGranted={accessGranted}
                                        taskTagsSection={taskTagsSection}
                                        forceTagsMobile={forceTagsMobile}
                                        trailingTagsCrowdTitle={trailingTagsCrowdTitle}
                                        setTagsExpandedHeight={setTagsExpandedHeight}
                                        inCommentPopup={inCommentPopup}
                                    />
                                )}
                            </Animated.View>
                            {!isActiveOrganizeMode && inMyDayOpenTab && isActiveTask && task.time && (
                                <LineOfTime time={task.time} tagsExpandedHeight={tagsExpandedHeight} />
                            )}
                        </View>
                        {isActiveOrganizeMode && <SixDotsContainer />}
                        {!inCommentPopup && (
                            <ShortcutsArea
                                task={task}
                                isActiveOrganizeMode={isActiveOrganizeMode}
                                accessGranted={accessGranted}
                                projectId={projectId}
                                isLocked={isLocked}
                            />
                        )}
                        {inCommentPopup && (
                            <CommentPopupWorkflowControls
                                projectId={projectId}
                                task={task}
                                workflow={workflow}
                                disabled={!loggedUserCanUpdateObject || !accessGranted || isLocked}
                                onDirectionalTransitionSuccess={onCommentPopupWorkflowTransitionSuccess}
                            />
                        )}
                    </View>
                </Swipeable>
            </Animated.View>
        </TaskFileDropZone>
    )
}

/**
 * The row wash stays deliberately quiet even though the rest of this sequence got louder. Adding a
 * task is occasional — `useLastAddedTaskColor` can afford a 600ms `UtilityBlue125` flash for it;
 * completing one happens constantly, including in bursts when a list is cleared, so a full-row
 * colour has to sit low in the attention order or it turns into strobing. The excitement was added
 * where it is bounded instead: inside the 24px checkbox, which cannot strobe a whole list.
 * `UtilityGreen125` at this alpha composites to roughly #DEF9EF over a white row.
 */
const COMPLETION_TINT_PEAK_OPACITY = 0.55

const localStyles = StyleSheet.create({
    dragModeContainer: {
        marginRight: 44,
    },
    blurry: {
        filter: 'blur(3px)',
        userSelect: 'none',
    },
    completionTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.UtilityGreen125,
        // Matches `taskPresentationLayout.taskRow` so the wash cannot square off the row's corners.
        borderRadius: 4,
        // Grows from the checkbox side. Passed through verbatim by react-native-web 0.21's
        // `preprocess` (it becomes CSS `transform-origin`) — without it the wash would expand from
        // the row's centre in both directions and the sweep would read backwards.
        transformOrigin: 'left center',
    },
})

const subTaskStyles = StyleSheet.create({
    taskRow: {
        backgroundColor: colors.Grey200,
        paddingHorizontal: 4,
        marginHorizontal: 16,
    },

    dragModeContainer: {
        marginRight: 44,
    },
})

export default forwardRef(TaskPresentation)
