import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Droppable } from 'react-beautiful-dnd'
import { useSelector, useDispatch } from 'react-redux'

import DraggableTask from './DraggableTask'
import DraggableTaskActive from './DraggableTaskActive'
import { generateDroppableListId } from './DragHelper'
import { colors } from '../styles/global'
import {
    addTaskIdWithSubtasksExpandedWhenActiveDragTaskMode,
    removeTaskIdWithSubtasksExpandedWhenActiveDragTaskMode,
} from '../../redux/actions'

export default function DroppableTaskList({
    projectId,
    disableDrag,
    taskList,
    taskListIndex,
    dateIndex,
    subtaskByTask,
    nestedTaskListIndex,
    isObservedTask,
    isToReviewTask,
    goalIndex,
}) {
    const dispatch = useDispatch()
    const tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode = useSelector(
        state => state.tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode
    )
    const draggingParentTaskId = useSelector(state => state.draggingParentTaskId)
    const [internalTaskList, serInternalTaksList] = useState([])
    const [listId, setListId] = useState(
        generateDroppableListId(projectId, goalIndex, taskListIndex, dateIndex, nestedTaskListIndex)
    )

    const updateTaskList = () => {
        const mixedTaskList = []
        for (let i = 0; i < taskList.length; i++) {
            const task = taskList[i]
            const { id } = task
            mixedTaskList.push(task)

            if (
                tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode[id] &&
                subtaskByTask[id] &&
                draggingParentTaskId !== id
            ) {
                mixedTaskList.push(...subtaskByTask[id])
            }
        }
        serInternalTaksList(mixedTaskList)
    }

    const expandOrContractSubtasks = (parentTaskId, expanded) => {
        expanded
            ? dispatch(addTaskIdWithSubtasksExpandedWhenActiveDragTaskMode(parentTaskId))
            : dispatch(removeTaskIdWithSubtasksExpandedWhenActiveDragTaskMode(parentTaskId))
    }

    useEffect(() => {
        updateTaskList()
    }, [taskList, subtaskByTask, draggingParentTaskId, tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode])

    return (
        <Droppable
            droppableId={listId}
            type={listId}
            isCombineEnabled={false}
            renderClone={(provided, snapshot, rubric) => {
                const task = internalTaskList[rubric.source.index]
                const subtaskList = subtaskByTask[task.id]
                return (
                    <DraggableTaskActive
                        projectId={projectId}
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
                    <View style={snapshot.isDraggingOver && localStyle.droppable}>
                        {internalTaskList.map((task, index) => {
                            return (
                                <DraggableTask
                                    key={task.id}
                                    projectId={projectId}
                                    disableDrag={disableDrag}
                                    task={task}
                                    index={index}
                                    isObservedTask={isObservedTask}
                                    isToReviewTask={isToReviewTask}
                                    subtaskList={subtaskByTask[task.id]}
                                    expandOrContractSubtasks={expandOrContractSubtasks}
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
