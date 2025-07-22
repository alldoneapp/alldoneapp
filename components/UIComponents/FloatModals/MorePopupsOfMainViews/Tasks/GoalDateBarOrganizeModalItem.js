import React from 'react'
import { useDispatch } from 'react-redux'

import {
    setActiveDragTaskModeInDate,
    clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
} from '../../../../../redux/actions'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { updateAllSelectedTasks } from '../../../../../redux/actions'
import store from '../../../../../redux/store'
import { MAIN_TASK_INDEX, MENTION_TASK_INDEX, SUGGESTED_TASK_INDEX } from '../../../../../utils/backends/openTasks'

export default function GoalDateBarOrganizeModalItem({
    text,
    shortcut,
    onPress,
    projectId,
    dateIndex,
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
        const { selectedTasks, goalOpenTasksData } = store.getState()
        const mainTasks = goalOpenTasksData[dateIndex][MAIN_TASK_INDEX]
        const mentionTasks = goalOpenTasksData[dateIndex][MENTION_TASK_INDEX]
        const suggestedTasks = goalOpenTasksData[dateIndex][SUGGESTED_TASK_INDEX]

        const tasks = []

        const addTasksInGroup = tasksList => {
            tasksList.forEach(taskToAdd => {
                tasks.push({ ...taskToAdd, projectId })
            })
        }

        addTasksInGroup(mainTasks)
        addTasksInGroup(suggestedTasks)
        addTasksInGroup(mentionTasks)

        dispatch(updateAllSelectedTasks(selectedTasks.length === tasks.length ? [] : tasks))
    }

    return <ModalItem icon={icon} text={text} shortcut={shortcut} onPress={activeDragMode} />
}
