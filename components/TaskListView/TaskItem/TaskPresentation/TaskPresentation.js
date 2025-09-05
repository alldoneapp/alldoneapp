import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import store from '../../../../redux/store'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem, setSwipeDueDatePopupData, showSwipeDueDatePopup } from '../../../../redux/actions'
import MyPlatform from '../../../MyPlatform'
import TasksHelper from '../../Utils/TasksHelper'
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
import {
    checkIfInMyDay,
    checkIfInMyDayOpenTab,
} from '../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import useLastAddedTaskColor from '../../useLastAddedTaskColor'
import CheckBoxWrapper from './CheckBoxContainer/CheckBoxWrapper'
import TitleContainer from './TitleContainer/TitleContainer'
import TaskTagsContainerByTime from './TaskTagsContainerByTime'
import TaskTagsContainer from './TaskTagsContainer'

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
    },
    ref
) {
    const dispatch = useDispatch()
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const inFocusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
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
    const [blockOpen, setBlockOpen] = useState(false)
    const [tagsExpandedHeight, setTagsExpandedHeight] = useState(0)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const itemSwipe = useRef()
    const taskTagsSection = useRef()
    const checkBoxRef = useRef(null)

    const inMyDay = checkIfInMyDay(
        selectedProjectIndex,
        showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    const inMyDayAndNotSubtask = inMyDay && !task.isSubtask

    const hasStar = task.hasStar.toUpperCase() === '#FFFFFF' && inMyDayAndNotSubtask ? colors.Grey500 : task.hasStar

    const lastAddedTaskBackgroundColor = useLastAddedTaskColor(task.id, lastTaskAddedId, hasStar)

    const inMyDayOpenTab = checkIfInMyDayOpenTab(
        selectedProjectIndex,
        showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    const isActiveTask = activeTaskId === task.id

    const pending =
        task.userIds?.length > 1 &&
        (task.userIds?.[task.userIds?.length - 1] !== currentUserId || route === 'GoalDetailedView') &&
        task.done === false &&
        !task.parentId

    useImperativeHandle(ref, () => ({
        onCheckboxPress: () => {
            checkBoxRef.current?.onCheckboxPress(pending || isSuggested || isObservedTask || isToReviewTask)
        },
    }))

    const renderLeftSwipe = (progress, dragX) => {
        if (panColor != dragX) setPanColor(dragX)
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

    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, task.isSubtask ? colors.Grey200 : '#ffffff', colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    const backColorHighlight = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, hasStar, colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    const highlightColor =
        lastTaskAddedId === task.id
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

    return (
        <View style={isLocked && !inParentGoal && localStyles.blurry}>
            <SwipeAreasContainer
                leftText={'Properties'}
                rightText={'Reminder'}
                isActiveOrganizeMode={isActiveOrganizeMode}
            />
            <Swipeable
                ref={itemSwipe}
                rightThreshold={80}
                leftThreshold={80}
                enabled={!activeEditMode && !isActiveOrganizeMode && !isLocked && anonymousGranted}
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
                <View style={localStyles.container}>
                    <View style={{ borderRadius: 4 }}>
                        <Animated.View
                            style={[
                                !isActiveOrganizeMode &&
                                    inFocusTaskId === task.id && { borderColor: colors.Primary100, borderWidth: 2 },
                                localStyles.taskRow,
                                task.isSubtask ? subTaskStyles.taskRow : undefined,
                                task.isSubtask ? { paddingLeft: 2 } : undefined,
                                isActiveOrganizeMode &&
                                    (task.isSubtask ? subTaskStyles.dragModeContainer : localStyles.dragModeContainer),
                                { backgroundColor: highlightColor },
                            ]}
                            onLayout={onLayoutChange}
                            nativeID={`task_body_${projectId}_${task.id}_${isObservedTask}`}
                        >
                            <View
                                pointerEvents={isActiveOrganizeMode || isLocked ? 'none' : 'auto'}
                                style={[
                                    localStyles.checkBoxLabel,
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
                                />
                                {!inMyDayAndNotSubtask && task?.gmailData && (
                                    <GmailTag
                                        gmailData={task.gmailData}
                                        propStyles={{ marginTop: 8, marginLeft: 12 }}
                                    />
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
                                    setTagsExpandedHeight={setTagsExpandedHeight}
                                />
                            )}
                        </Animated.View>
                        {!isActiveOrganizeMode && inMyDayOpenTab && isActiveTask && task.time && (
                            <LineOfTime time={task.time} tagsExpandedHeight={tagsExpandedHeight} />
                        )}
                    </View>
                    {isActiveOrganizeMode && <SixDotsContainer />}
                    <ShortcutsArea
                        task={task}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        accessGranted={accessGranted}
                        projectId={projectId}
                        isLocked={isLocked}
                    />
                </View>
            </Swipeable>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        marginLeft: -16,
        marginRight: -16,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginHorizontal: 8,
        borderRadius: 4,
    },
    checkBoxLabel: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    dragModeContainer: {
        marginRight: 44,
    },
    blurry: {
        filter: 'blur(3px)',
        userSelect: 'none',
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
