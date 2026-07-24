import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Droppable } from 'react-beautiful-dnd'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'

import DraggableTask from './DraggableTask'
import DraggableTaskActive from './DraggableTaskActive'
import { colors } from '../styles/global'
import {
    addTaskIdWithSubtasksExpandedWhenActiveDragTaskMode,
    removeTaskIdWithSubtasksExpandedWhenActiveDragTaskMode,
} from '../../redux/actions'
import { getTasksAndExpandedSubtasks } from './MyDayDragHelper'

export default function MyDayDroppableTaskList({ taskList, taskListId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const myDayOpenSubtasksMap = useSelector(state => state.myDayOpenSubtasksMap)
    const tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode = useSelector(
        state => state.tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode
    )
    const draggingParentTaskId = useSelector(state => state.draggingParentTaskId)
    const [internalTaskList, serInternalTaksList] = useState([])

    const endOfDay = moment().endOf('day').valueOf()
    const lastTaskIndex = internalTaskList.length - 1

    const updateTaskList = () => {
        const mixedTaskList = getTasksAndExpandedSubtasks(
            taskList,
            myDayOpenSubtasksMap,
            tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
            draggingParentTaskId
        )
        serInternalTaksList(mixedTaskList)
    }

    const expandOrContractSubtasks = (parentTaskId, expanded) => {
        expanded
            ? dispatch(addTaskIdWithSubtasksExpandedWhenActiveDragTaskMode(parentTaskId))
            : dispatch(removeTaskIdWithSubtasksExpandedWhenActiveDragTaskMode(parentTaskId))
    }

    useEffect(() => {
        updateTaskList()
    }, [taskList, myDayOpenSubtasksMap, draggingParentTaskId, tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode])

    return (
        <Droppable
            droppableId={taskListId}
            isCombineEnabled={false}
            renderClone={(provided, snapshot, rubric) => {
                const task = internalTaskList[rubric.source.index]
                const { projectId, userIds, dueDateByObserversIds, currentReviewerId, dueDate } = task

                const subtaskList = myDayOpenSubtasksMap[projectId]?.[task.id] || []
                const isObservedTask = dueDateByObserversIds[loggedUserId] <= endOfDay
                const isToReviewTask = userIds.length > 1 && currentReviewerId === loggedUserId && dueDate <= endOfDay

                return (
                    <DraggableTaskActive
                        projectId={task.projectId}
                        task={task}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                        subtaskList={subtaskList}
                        isObservedTask={isObservedTask}
                        isToReviewTask={isToReviewTask}
                    />
                )
            }}
        >
            {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                    <View style={[{ marginTop: 16 }, snapshot.isDraggingOver && localStyle.droppable]}>
                        {internalTaskList.map((task, index) => {
                            const {
                                projectId,
                                stepHistory,
                                userIds,
                                dueDateByObserversIds,
                                currentReviewerId,
                                dueDate,
                            } = task
                            const subtaskList = myDayOpenSubtasksMap[projectId]?.[task.id] || []
                            const isObservedTask = dueDateByObserversIds[loggedUserId] <= endOfDay
                            const marginBottom = lastTaskIndex === index ? 0 : 16
                            const isToReviewTask =
                                userIds.length > 1 && currentReviewerId === loggedUserId && dueDate <= endOfDay
                            const currentStepId = stepHistory[stepHistory.length - 1]
                            const key = isToReviewTask ? task.id + currentStepId : task.id

                            return (
                                <DraggableTask
                                    key={key}
                                    projectId={task.projectId}
                                    disableDrag={false}
                                    task={task}
                                    index={index}
                                    isObservedTask={isObservedTask}
                                    isToReviewTask={isToReviewTask}
                                    subtaskList={subtaskList}
                                    expandOrContractSubtasks={expandOrContractSubtasks}
                                    containerStyle={{ marginHorizontal: 8, marginBottom }}
                                />
                            )
                        })}
                        {provided.placeholder}
                    </View>
                </div>
            )}
        </Droppable>
    )
}

const localStyle = StyleSheet.create({
    droppable: {
        backgroundColor: colors.Grey300,
    },
})
