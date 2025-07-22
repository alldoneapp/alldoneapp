import React from 'react'
import { useSelector } from 'react-redux'

import TaskPresentation from './TaskItem/TaskPresentation/TaskPresentation'
import TaskPresentationDragging from './TaskPresentationDragging'
import { objectIsLockedForUser } from '../Guides/guidesHelper'

export default function TaskPresentationContainer({
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
    inParentGoal,
    isPending,
}) {
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)

    const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, task.lockKey, task.userId)

    return !isLocked && isActiveOrganizeMode && provided ? (
        <TaskPresentationDragging
            projectId={projectId}
            isObservedTask={isObservedTask}
            isToReviewTask={isToReviewTask}
            isActiveOrganizeMode={isActiveOrganizeMode}
            provided={provided}
            task={task}
            taskItemRef={taskItemRef}
            toggleModal={toggleModal}
            toggleSubTaskList={toggleSubTaskList}
            subtaskList={subtaskList}
            isSuggested={isSuggested}
            checked={checked}
            isPending={isPending}
        />
    ) : (
        <TaskPresentation
            ref={taskItemRef}
            projectId={projectId}
            task={task}
            toggleModal={toggleModal}
            toggleSubTaskList={toggleSubTaskList}
            subtaskList={subtaskList}
            isSuggested={isSuggested}
            isObservedTask={isObservedTask}
            isToReviewTask={isToReviewTask}
            inParentGoal={inParentGoal}
            isPending={isPending}
        />
    )
}
