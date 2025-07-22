import { useState, useEffect } from 'react'
import moment from 'moment'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import TasksHelper, { OPEN_STEP, RECURRENCE_NEVER } from '../Utils/TasksHelper'
import { LINKED_OBJECT_TYPE_TASK } from '../../../utils/LinkingHelper'
import { DV_TAB_GOAL_LINKED_TASKS } from '../../../utils/TabNavigationConstants'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Backend from '../../../utils/BackendBridge'
import { checkIfInMyDay } from '../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

export default function useTagsAmount({
    task,
    isSubtask,
    projectId,
    isObservedTask,
    isToReviewTask,
    subtaskList,
    isSuggested,
    isPending,
}) {
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const inBacklinksView = useSelector(state => state.inBacklinksView)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const [backlinksTasksCount, setBacklinksTasksCount] = useState(0)
    const [backlinksNotesCount, setBacklinksNotesCount] = useState(0)

    const getEstimationsTagsInfo = () => {
        const { estimations, userIds, stepHistory, estimationsByObserverIds } = task

        const ownerEstimation = estimations[OPEN_STEP] || 0
        const currentStepId = stepHistory[userIds.length - 1]

        let currentReviewerEstimation = 0
        let observerEstimation = 0

        if (isToReviewTask || isPending) {
            currentReviewerEstimation = estimations[currentStepId] || 0
        }
        if (isObservedTask) observerEstimation = estimationsByObserverIds[currentUserId] || 0

        return { ownerEstimation, currentReviewerEstimation, observerEstimation }
    }

    const getAmountOfTags = () => {
        const inBacklog = task.dueDate === Number.MAX_SAFE_INTEGER
        const backlinksCount = backlinksTasksCount + backlinksNotesCount
        const isOverdue = moment(task.dueDate).isBefore(moment(), 'day')
        const isToday = moment(task.dueDateByObserversIds[currentUserId]).isSame(moment(), 'day')
        const ownerIsWorkstream = task.userId.startsWith(WORKSTREAM_ID_PREFIX)
        const taskOwner = ownerIsWorkstream ? loggedUser : TasksHelper.getTaskOwner(task.userId, projectId)
        const inGoalLinkedTasksView = selectedTab === DV_TAB_GOAL_LINKED_TASKS
        const { ownerEstimation, observerEstimation, currentReviewerEstimation } = getEstimationsTagsInfo()
        const inMyDayAndNotSubtask =
            checkIfInMyDay(
                selectedProjectIndex,
                loggedUser.showAllProjectsByTime,
                route,
                selectedSidebarTab,
                taskViewToggleIndex
            ) && !task.isSubtask

        let counter = 0

        if (inMyDayAndNotSubtask && task.parentGoalId) counter++
        if (!!task.commentsData) counter++
        if (subtaskList && subtaskList.length > 0) counter++
        if (isToReviewTask && currentReviewerEstimation > 0) counter++
        if (!isToReviewTask && isObservedTask && observerEstimation > 0) counter++
        if (isPending && currentReviewerEstimation > 0) counter++
        if (ownerEstimation > 0) counter++
        if (task.timesPostponed >= 3) counter++
        if (task.timesFollowed >= 3) counter++
        if (task.recurrence !== RECURRENCE_NEVER && task.timesDoneInExpectedDay >= 3) counter++
        if (task.recurrence !== RECURRENCE_NEVER && task.timesDoneInExpectedDay < 3 && task.timesDone >= 3) counter++
        if (task.isPrivate) counter++
        if (task.recurrence !== RECURRENCE_NEVER) counter++
        if (task.noteId) counter++
        if (backlinksCount > 0) counter++
        if (task?.description?.length > 0) counter++
        if (isObservedTask && !isToday && ((!task.done && !inBacklog) || inBacklinksView)) counter++
        if ((isOverdue && !task.done && !inBacklog) || inBacklinksView) counter++
        if ((inBacklinksView || inGoalLinkedTasksView) && taskOwner) counter++
        if (inMyDayAndNotSubtask && isObservedTask) counter++
        if (inMyDayAndNotSubtask && isSuggested && !isSubtask) counter++
        if (inMyDayAndNotSubtask && isToReviewTask) counter++
        if (inMyDayAndNotSubtask && ownerIsWorkstream) counter++

        return counter
    }

    useEffect(() => {
        const watcherKey = v4()

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
                } else if (parentObjectType === 'notes') {
                    setBacklinksNotesCount(parentsAmount)
                }
            },
            watcherKey
        )

        return () => {
            Backend.unwatchBacklinksCount(task.id, watcherKey)
        }
    }, [task.id])

    return getAmountOfTags()
}
