import React, { useState, useEffect } from 'react'
import { TouchableOpacity } from 'react-native'

import TaskPresentation from './TaskItem/TaskPresentation/TaskPresentation'
import { setSelectedTasks } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'

export default function TaskPresentationDragging({
    projectId,
    isObservedTask,
    isToReviewTask,
    isActiveOrganizeMode,
    provided,
    task,
    taskItemRef,
    toggleModal,
    toggleSubTaskList,
    subtaskList,
    isSuggested,
    checked,
    isPending,
}) {
    const dispatch = useDispatch()
    const isDragging = useSelector(state => state.isDragging)
    const selectedTasks = useSelector(state => state.selectedTasks)
    const [checkOnDrag, setCheckOnDrag] = useState(checked)

    const selectTask = () => {
        setCheckOnDrag(checkOnDrag => !checkOnDrag)
        !isDragging && dispatch(setSelectedTasks({ ...task, projectId, isObservedTask, isToReviewTask }, null))
    }

    useEffect(() => {
        if (selectedTasks.length === 0) {
            setCheckOnDrag(false)
        } else if (selectedTasks.some(selectedTask => selectedTask.id === task.id)) {
            setCheckOnDrag(true)
        }
    }, [selectedTasks])

    return (
        <div {...provided.dragHandleProps}>
            <TouchableOpacity onPress={selectTask} accessible={false}>
                <TaskPresentation
                    ref={taskItemRef}
                    projectId={projectId}
                    task={task}
                    toggleModal={toggleModal}
                    toggleSubTaskList={toggleSubTaskList}
                    subtaskList={subtaskList}
                    checkOnDrag={checkOnDrag}
                    isSuggested={isSuggested}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    isPending={isPending}
                />
            </TouchableOpacity>
        </div>
    )
}
