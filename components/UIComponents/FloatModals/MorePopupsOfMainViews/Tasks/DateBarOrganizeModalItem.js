import React from 'react'
import {
    setActiveDragTaskModeInDate,
    clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
} from '../../../../../redux/actions'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { useDispatch } from 'react-redux'
import { updateAllSelectedTasks } from '../../../../../redux/actions'
import store from '../../../../../redux/store'
import {
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
    WORKFLOW_TASK_INDEX,
} from '../../../../../utils/backends/openTasks'
import { objectIsLockedForUser } from '../../../../Guides/guidesHelper'

export default function DateBarOrganizeModalItem({
    text,
    shortcut,
    onPress,
    projectId,
    dateIndex,
    instanceKey,
    selectTasks,
    icon,
}) {
    const dispatch = useDispatch()
    const activeDragMode = e => {
        e?.preventDefault()
        e?.stopPropagation()
        dispatch([
            setActiveDragTaskModeInDate(projectId, dateIndex),
            clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode(),
        ])
        if (selectTasks) selectAllTasks()
        onPress()
    }

    const selectAllTasks = () => {
        const { selectedTasks, filteredOpenTasksStore, loggedUser } = store.getState()
        const mainTasks = filteredOpenTasksStore[instanceKey][dateIndex][MAIN_TASK_INDEX]
        const mentionTasks = filteredOpenTasksStore[instanceKey][dateIndex][MENTION_TASK_INDEX]
        const suggestedTasks = filteredOpenTasksStore[instanceKey][dateIndex][SUGGESTED_TASK_INDEX]
        const receivedFrom = filteredOpenTasksStore[instanceKey][dateIndex][WORKFLOW_TASK_INDEX]
        const observedTasks = filteredOpenTasksStore[instanceKey][dateIndex][OBSERVED_TASKS_INDEX]
        const streamAndUserTasks = filteredOpenTasksStore[instanceKey][dateIndex][STREAM_AND_USER_TASKS_INDEX]

        const tasks = []

        const addTasksInGroup = (groupData, isObserved) => {
            groupData.forEach(data => {
                data[1].forEach(taskToAdd => {
                    const isLocked = objectIsLockedForUser(
                        projectId,
                        loggedUser.unlockedKeysByGuides,
                        taskToAdd.lockKey,
                        taskToAdd.userId
                    )
                    if (!isLocked) {
                        if (isObserved) {
                            if (tasks.every(task => task.id !== taskToAdd.id))
                                tasks.push({ ...taskToAdd, projectId, isObservedTask: true })
                        } else {
                            tasks.push({ ...taskToAdd, projectId })
                        }
                    }
                })
            })
        }

        const addTaskInNestedGroup = (group, isObserved) => {
            group.forEach(groupData => {
                addTasksInGroup(groupData[1], isObserved)
            })
        }

        addTasksInGroup(mainTasks, false)
        addTaskInNestedGroup(suggestedTasks, false)
        addTasksInGroup(mentionTasks, false)
        addTaskInNestedGroup(streamAndUserTasks, false)
        addTaskInNestedGroup(receivedFrom, false)
        addTaskInNestedGroup(observedTasks, true)

        dispatch(updateAllSelectedTasks(selectedTasks.length === tasks.length ? [] : tasks))
    }

    return <ModalItem icon={icon} text={text} shortcut={shortcut} onPress={activeDragMode} />
}
