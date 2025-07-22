import React, { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import DismissibleItem from '../UIComponents/DismissibleItem'
import TaskPresentationContainer from './TaskPresentationContainer'
import store from '../../redux/store'
import { setCheckTaskItem } from '../../redux/actions'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import EditTask from './TaskItem/EditTask'

export default function TaskItem({
    projectId,
    task,
    isObservedTask,
    isToReviewTask,
    isActiveOrganizeMode,
    provided,
    dismissibleRef,
    taskItemRef,
    toggleSubTaskList,
    isSuggested,
    checked,
    showSubTaskList,
    setInEditMode,
    setShowSubTaskIndicator,
    subtaskList,
    inParentGoal,
    isPending,
}) {
    const dispatch = useDispatch()
    const isCheckedTaskItem = useSelector(
        state => state.checkTaskItem.id === task.id && state.checkTaskItem.isObserved === !!isObservedTask
    )
    const showSwipeDueDatePopup = useSelector(state => state.showSwipeDueDatePopup)

    const toggleModal = () => {
        if (!showSwipeDueDatePopup.visible) dismissibleRef.current.toggleModal()
    }

    const toggleSubTaskIndicator = value => {
        if (subtaskList.length > 0 || showSubTaskList) value = true
        setShowSubTaskIndicator(value)
    }

    const onToggleModal = value => {
        const { showSwipeDueDatePopup, loggedUser } = store.getState()
        if (!showSwipeDueDatePopup.visible && !loggedUser.isAnonymous) toggleSubTaskIndicator(value)
        setInEditMode(inEditMode => !inEditMode)
    }

    const editModeCheckOff = () => {
        dismissibleRef.current.toggleModal()
        setTimeout(() => {
            taskItemRef.current.onCheckboxPress()
        }, 100)
    }

    useEffect(() => {
        if (isCheckedTaskItem) {
            const { unlockedKeysByGuides, uid } = store.getState().loggedUser
            const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, task.lockKey, task.userId)

            if (isLocked) {
                dispatch(setCheckTaskItem('', false))
            } else {
                const loggedUserIsTaskOwner = uid === task.userId
                const loggedUserCanUpdateObject =
                    loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

                const { activeEditMode } = store.getState()
                dispatch(setCheckTaskItem('', false))

                if (loggedUserCanUpdateObject)
                    activeEditMode ? editModeCheckOff() : taskItemRef.current.onCheckboxPress()
            }
        }
    }, [isCheckedTaskItem])

    return (
        <DismissibleItem
            ref={dismissibleRef}
            defaultComponent={
                <TaskPresentationContainer
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
                    inParentGoal={inParentGoal}
                    isPending={isPending}
                />
            }
            modalComponent={
                <EditTask
                    projectId={projectId}
                    task={task}
                    showSubTaskList={showSubTaskList}
                    toggleSubTaskList={toggleSubTaskList}
                    onCancelAction={forceAction => {
                        dismissibleRef.current.closeModal(false, forceAction)
                    }}
                    editModeCheckOff={editModeCheckOff}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    isPending={isPending}
                />
            }
            onToggleModal={onToggleModal}
        />
    )
}
