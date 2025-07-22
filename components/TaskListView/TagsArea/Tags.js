import React, { useState, useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import Icon from '../../Icon'
import TaskEstimation from '../../Tags/TaskEstimation'
import TaskSubTasks from '../../Tags/TaskSubTasks'
import TaskSummation from '../../Tags/TaskSummation'
import TaskRecurrence from '../../Tags/TaskRecurrence'
import TasksHelper, { OPEN_STEP, RECURRENCE_NEVER } from '../Utils/TasksHelper'
import TaskCommentsWrapper from '../../Tags/TaskCommentsWrapper'
import DateTagButton from '../../UIControls/DateTagButton'
import BacklinksTag from '../../Tags/BacklinksTag'
import PrivacyTag from '../../Tags/PrivacyTag'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import DescriptionTag from '../../Tags/DescriptionTag'
import { LINKED_OBJECT_TYPE_TASK, getDvMainTabLink } from '../../../utils/LinkingHelper'
import ObjectNoteTag from '../../Tags/ObjectNoteTag'
import { getEstimationRealValue } from '../../../utils/EstimationHelper'
import CounterTag from '../../Tags/CounterTag'
import TaskTypeTag from '../../Tags/TaskTypeTag'
import ProjectTag from '../../Tags/ProjectTag'
import { DV_TAB_GOAL_LINKED_TASKS } from '../../../utils/TabNavigationConstants'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Backend from '../../../utils/BackendBridge'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { setTaskDescription, setTaskDueDate, setTaskToBacklog } from '../../../utils/backends/Tasks/tasksFirestore'
import GoalTag from '../../Tags/GoalTag'
import { checkIfInMyDay, checkIfInMyDayOpenTab } from '../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

export default function Tags({
    task,
    isSubtask,
    projectId,
    isObservedTask,
    isToReviewTask,
    toggleSubTaskList,
    subtaskList,
    isActiveOrganizeMode,
    accessGranted,
    anonymousGranted,
    forceTagsMobile,
    isLocked,
    isSuggested,
    tagsStyle,
    isPending,
    needSummarize,
}) {
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const inBacklinksView = useSelector(state => state.inBacklinksView)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [backlinksTasksCount, setBacklinksTasksCount] = useState(0)
    const [backlinkTaskObject, setBacklinkTaskObject] = useState(null)
    const [backlinksNotesCount, setBacklinksNotesCount] = useState(0)
    const [backlinkNoteObject, setBacklinkNoteObject] = useState(null)

    const inMyDayOpenTab = checkIfInMyDayOpenTab(
        selectedProjectIndex,
        loggedUser.showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    const inMyDayAndNotSubtask =
        checkIfInMyDay(
            selectedProjectIndex,
            loggedUser.showAllProjectsByTime,
            route,
            selectedSidebarTab,
            taskViewToggleIndex
        ) && !task.isSubtask

    const inGoalLinkedTasksView = selectedTab === DV_TAB_GOAL_LINKED_TASKS

    const ownerIsWorkstream = task.userId.startsWith(WORKSTREAM_ID_PREFIX)
    const taskOwner = ownerIsWorkstream ? loggedUser : TasksHelper.getTaskOwner(task.userId, projectId)

    const navigateToDv = () => {
        const path = getDvMainTabLink(projectId, task.id, 'tasks')
        URLTrigger.processUrl(NavigationService, path)
    }

    const getSumEstimation = subtaskList => {
        return subtaskList.reduce((sum, subTask) => {
            return sum + getEstimationRealValue(projectId, subTask.estimations[OPEN_STEP])
        }, 0)
    }

    const getEstimationsTagsInfo = () => {
        const { estimations, userIds, stepHistory, estimationsByObserverIds } = task

        const ownerEstimation = estimations[OPEN_STEP] || 0
        const currentStepId = stepHistory[userIds.length - 1]

        let currentReviewerEstimation = 0
        let observerEstimation = 0
        let reviwerPhotoURL

        if (isToReviewTask || isPending) {
            currentReviewerEstimation = estimations[currentStepId] || 0

            if (isPending) {
                const reviewerUid =
                    taskOwner.workflow && taskOwner.workflow[projectId] && taskOwner.workflow[projectId][currentStepId]
                        ? taskOwner.workflow[projectId][currentStepId].reviewerUid
                        : ''
                const reviewer = TasksHelper.getUser(reviewerUid)
                reviwerPhotoURL = reviewer.photoURL
            }
        }
        if (isObservedTask) observerEstimation = estimationsByObserverIds[currentUserId] || 0

        return { reviwerPhotoURL, ownerEstimation, currentReviewerEstimation, currentStepId, observerEstimation }
    }

    const updateDescription = description => {
        setTaskDescription(projectId, task.id, description, task, task.description)
    }

    const {
        ownerEstimation,
        observerEstimation,
        currentReviewerEstimation,
        currentStepId,
        reviwerPhotoURL,
    } = getEstimationsTagsInfo()

    const isOverdue = moment(task.dueDate).isBefore(moment(), 'day')
    const isToday = moment(task.dueDateByObserversIds[currentUserId]).isSame(moment(), 'day')

    const { commentsData } = task

    const backlinksCount = backlinksTasksCount + backlinksNotesCount

    const backlinkObject =
        backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null

    const inBacklog = task.dueDate === Number.MAX_SAFE_INTEGER

    const loggedUserIsTaskOwner = loggedUser.uid === task.userId
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const photoURL = isObservedTask || isToReviewTask ? taskOwner.photoURL : undefined

    const updateTaskDate = async (dateTimestamp, isObservedTabActive) => {
        const inReview = task.userIds.length > 0 && !task.inDone
        const moveObservedDateAndDueDate = inMyDayOpenTab && isObservedTask && inReview

        if (moveObservedDateAndDueDate) {
            await setTaskDueDate(projectId, task.id, dateTimestamp, task, false, null)
            await setTaskDueDate(projectId, task.id, dateTimestamp, task, true, null)
        } else {
            setTaskDueDate(projectId, task.id, dateTimestamp, task, isObservedTabActive, null)
        }
    }

    const updateTaskDateToBacklog = async isObservedTabActive => {
        const inReview = task.userIds.length > 0 && !task.inDone
        const moveObservedDateAndDueDate = inMyDayOpenTab && isObservedTask && inReview

        if (moveObservedDateAndDueDate) {
            await setTaskToBacklog(projectId, task.id, task, false, null)
            await setTaskToBacklog(projectId, task.id, task, true, null)
        } else {
            setTaskToBacklog(projectId, task.id, task, isObservedTabActive, null)
        }
    }

    useEffect(() => {
        Backend.watchBacklinksCount(
            projectId,
            {
                type: LINKED_OBJECT_TYPE_TASK,
                idsField: 'linkedParentTasksIds',
                id: task.id,
            },
            (parentObjectType, parentsAmount, aloneParentObject) => {
                if (parentObjectType === 'tasks') {
                    setBacklinksTasksCount(parentsAmount)
                    setBacklinkTaskObject(aloneParentObject)
                } else if (parentObjectType === 'notes') {
                    setBacklinksNotesCount(parentsAmount)
                    setBacklinkNoteObject(aloneParentObject)
                }
            }
        )

        return () => {
            Backend.unwatchBacklinksCount(task.id)
        }
    }, [task.id])

    const tagAlignment = { marginLeft: 8 }

    return (
        <>
            {!!commentsData && (
                <TaskCommentsWrapper
                    tagStyle={tagsStyle}
                    commentsData={commentsData}
                    projectId={projectId}
                    objectId={task.id}
                    objectType="tasks"
                    userGettingKarmaId={task.userId}
                    disabled={isActiveOrganizeMode || isLocked}
                    objectName={task.name}
                    assistantId={task.assistantId}
                />
            )}
            {subtaskList && subtaskList.length > 0 && (
                <TaskSubTasks
                    style={[tagAlignment, tagsStyle]}
                    amountOfSubTasks={subtaskList.length}
                    onPress={toggleSubTaskList}
                    isMobile={forceTagsMobile}
                    disabled={isLocked}
                />
            )}
            {subtaskList && subtaskList.length > 0 && (
                <TaskSummation
                    projectId={projectId}
                    estimation={getSumEstimation(subtaskList)}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked}
                />
            )}

            {(isToReviewTask || isPending) && currentReviewerEstimation > 0 && (
                <TaskEstimation
                    task={task}
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    currentEstimation={currentReviewerEstimation}
                    stepId={currentStepId}
                    disabled={isLocked || !accessGranted || !loggedUserCanUpdateObject}
                    photoUrl={reviwerPhotoURL}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {!isToReviewTask && isObservedTask && observerEstimation > 0 && (
                <TaskEstimation
                    task={task}
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    currentEstimation={observerEstimation}
                    observerId={currentUserId}
                    disabled={isLocked || !accessGranted || !loggedUserCanUpdateObject}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {ownerEstimation > 0 && (
                <TaskEstimation
                    task={task}
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    currentEstimation={ownerEstimation}
                    stepId={OPEN_STEP}
                    photoUrl={photoURL}
                    disabled={
                        task.inDone ||
                        isToReviewTask ||
                        isPending ||
                        isLocked ||
                        !accessGranted ||
                        !loggedUserCanUpdateObject
                    }
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {task.timesPostponed >= 3 && (
                <CounterTag
                    icon={'coffee'}
                    style={[tagAlignment, tagsStyle]}
                    counter={task.timesPostponed}
                    onPress={navigateToDv}
                    disabled={isActiveOrganizeMode || isLocked}
                />
            )}
            {task.timesFollowed >= 3 && (
                <CounterTag
                    icon={'calendar-up'}
                    style={[tagAlignment, tagsStyle]}
                    counter={task.timesFollowed}
                    onPress={navigateToDv}
                    disabled={isActiveOrganizeMode || isLocked}
                />
            )}
            {task.recurrence !== RECURRENCE_NEVER && task.timesDoneInExpectedDay >= 3 && (
                <CounterTag
                    icon={'thumbs-up-checked'}
                    style={[tagAlignment, tagsStyle]}
                    counter={task.timesDoneInExpectedDay}
                    onPress={navigateToDv}
                    disabled={isActiveOrganizeMode || isLocked}
                />
            )}
            {task.recurrence !== RECURRENCE_NEVER && task.timesDoneInExpectedDay < 3 && task.timesDone >= 3 && (
                <CounterTag
                    icon={'square-checked'}
                    style={[tagAlignment, tagsStyle]}
                    counter={task.timesDone}
                    onPress={navigateToDv}
                    disabled={isActiveOrganizeMode || isLocked}
                />
            )}
            {task.isPrivate && (
                <PrivacyTag
                    projectId={projectId}
                    object={task}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked || !accessGranted || !loggedUserCanUpdateObject}
                />
            )}
            {task.recurrence !== RECURRENCE_NEVER && (
                <TaskRecurrence
                    task={task}
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked || !accessGranted || !loggedUserCanUpdateObject}
                />
            )}
            {task.noteId && (
                <ObjectNoteTag
                    objectId={task.id}
                    objectType="tasks"
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    disabled={isActiveOrganizeMode || isLocked || !anonymousGranted}
                />
            )}
            {backlinksCount > 0 && (
                <BacklinksTag
                    object={task}
                    objectType={LINKED_OBJECT_TYPE_TASK}
                    projectId={projectId}
                    style={[tagAlignment, tagsStyle]}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked || !anonymousGranted}
                    backlinksCount={backlinksCount}
                    backlinkObject={backlinkObject}
                />
            )}
            {task?.description?.length > 0 && (
                <DescriptionTag
                    projectId={projectId}
                    object={task}
                    style={[tagAlignment, tagsStyle]}
                    disabled={isActiveOrganizeMode || isLocked || !anonymousGranted || !loggedUserCanUpdateObject}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    updateDescription={updateDescription}
                />
            )}
            {isObservedTask && !isToday && ((!task.done && !inBacklog) || inBacklinksView) && (
                <DateTagButton
                    task={task}
                    projectId={projectId}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked || !accessGranted || !loggedUserCanUpdateObject}
                    style={[tagAlignment, tagsStyle]}
                    saveDueDateBeforeSaveTask={updateTaskDate}
                    setToBacklogBeforeSaveTask={updateTaskDateToBacklog}
                    isObservedTask={isObservedTask}
                />
            )}
            {((isOverdue && !task.done && !inBacklog) || inBacklinksView) && (
                <DateTagButton
                    task={task}
                    projectId={projectId}
                    isMobile={forceTagsMobile}
                    disabled={isActiveOrganizeMode || isLocked || !accessGranted || !loggedUserCanUpdateObject}
                    style={[tagAlignment, tagsStyle]}
                    saveDueDateBeforeSaveTask={updateTaskDate}
                    setToBacklogBeforeSaveTask={updateTaskDateToBacklog}
                />
            )}
            {(inBacklinksView || inGoalLinkedTasksView) && taskOwner && (
                <View style={[localStyles.notesAssignee, tagAlignment, tagsStyle]}>
                    {ownerIsWorkstream ? (
                        <Icon name="workstream" size={24} color={colors.Text03} />
                    ) : (
                        <Image style={localStyles.notesAssigneeImage} source={taskOwner?.photoURL} />
                    )}
                </View>
            )}
            {inMyDayAndNotSubtask && isObservedTask && (
                <TaskTypeTag icon={'search'} text={'Observed'} containerStyle={[tagAlignment, tagsStyle]} />
            )}
            {inMyDayAndNotSubtask && isSuggested && !isSubtask && (
                <TaskTypeTag icon={'sun'} text={'Suggested'} containerStyle={[tagAlignment, tagsStyle]} />
            )}
            {inMyDayAndNotSubtask && isToReviewTask && !isSubtask && (
                <TaskTypeTag icon={'workflow'} text={'To review'} containerStyle={[tagAlignment, tagsStyle]} />
            )}
            {inMyDayAndNotSubtask && ownerIsWorkstream && !isSubtask && (
                <TaskTypeTag icon={'workstream'} text={'Workstream'} containerStyle={[tagAlignment, tagsStyle]} />
            )}
            {inMyDayAndNotSubtask && task.parentGoalId && (
                <GoalTag
                    containerStyle={[tagAlignment, tagsStyle]}
                    projectId={projectId}
                    goalId={task.parentGoalId}
                    disabled={isActiveOrganizeMode}
                />
            )}
            {!needSummarize && inMyDayAndNotSubtask && (
                <ProjectTag
                    style={[tagAlignment, tagsStyle]}
                    projectId={projectId}
                    disabled={isActiveOrganizeMode || isLocked || !accessGranted}
                    shrinkTextToAmountOfLetter={8}
                />
            )}
        </>
    )
}

const localStyles = StyleSheet.create({
    notesAssignee: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    notesAssigneeImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
