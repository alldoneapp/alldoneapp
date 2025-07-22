import React, { useState, useRef, useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import SubTasksView from './Subtask/SubTasksView'
import { setFocusedTaskItem, unsetUploadedNewSubtask } from '../../redux/actions'
import TaskIndicator from './TaskIndicator'
import TaskItem from './TaskItem'
import store from '../../redux/store'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from './Utils/TasksHelper'

export default function ParentTaskContainer({
    projectId,
    task,
    isActiveOrganizeMode,
    expandOrContractSubtasks,
    isObservedTask,
    isToReviewTask,
    isSuggested,
    checked,
    subtaskList,
    provided,
    inParentGoal,
    containerStyle,
    isPending,
}) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const isFocusedTaskItem = useSelector(state => state.focusedTaskItem.id === task.id)
    const draggingParentTaskId = useSelector(state => state.draggingParentTaskId)
    const [inEditMode, setInEditMode] = useState(false)
    const [showSubTaskList, setShowSubTaskList] = useState(false)
    const [showSubTaskIndicator, setShowSubTaskIndicator] = useState(false)
    const parentRef = useRef(null)
    const dismissibleRef = useRef(null)
    const taskItemRef = useRef(null)

    const setAriaTaskId = () => {
        parentRef.current.setNativeProps({ 'aria-task-id': task.id })
        parentRef.current.setNativeProps({ 'is-observed-task': isObservedTask ? 'true' : 'false' })
    }

    const toggleSubTaskList = () => {
        showSubTaskList ? hideSubtaskList() : showSubtaskList()
    }

    const showSubtaskList = () => {
        if (expandOrContractSubtasks) expandOrContractSubtasks(task.id, true)
        setShowSubTaskList(true)
    }

    const hideSubtaskList = () => {
        if (expandOrContractSubtasks) expandOrContractSubtasks(task.id, false)
        setShowSubTaskList(false)
        if (subtaskList.length === 0) setShowSubTaskIndicator(false)
    }

    useEffect(() => {
        setAriaTaskId()
        return () => {
            if (expandOrContractSubtasks) expandOrContractSubtasks(task.id, false)
        }
    }, [])

    useEffect(() => {
        if (subtaskList.length > 0) {
            const { uploadedNewSubtask } = store.getState()
            if (uploadedNewSubtask) {
                showSubtaskList()
                dispatch(unsetUploadedNewSubtask())
            }
        }
    }, [subtaskList.length])

    useEffect(() => {
        if (showSubTaskList && subtaskList.length === 0 && isActiveOrganizeMode) {
            setShowSubTaskList(false)
            if (expandOrContractSubtasks) expandOrContractSubtasks(task.id, false)
        }
    }, [showSubTaskList, isActiveOrganizeMode, subtaskList.length])

    useEffect(() => {
        if (isFocusedTaskItem) {
            const { unlockedKeysByGuides } = store.getState().loggedUser
            const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, task.lockKey, task.userId)

            if (isLocked) {
                dispatch(setFocusedTaskItem('', false))
            } else {
                const { activeEditMode } = store.getState()
                if (!activeEditMode) dismissibleRef.current.openModal()
            }
        }
    }, [isFocusedTaskItem])

    const loggedUserIsTaskOwner = loggedUserId === task.userId
    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View ref={parentRef} style={containerStyle}>
            {(loggedUserCanUpdateObject || subtaskList.length > 0) &&
            !isMiddleScreen &&
            (subtaskList.length > 0 || showSubTaskIndicator) &&
            !isAssistant ? (
                <TaskIndicator
                    inEditMode={inEditMode}
                    dismissibleRef={dismissibleRef.current}
                    toggleSubTaskList={toggleSubTaskList}
                    showSubTaskList={showSubTaskList}
                />
            ) : null}
            <TaskItem
                projectId={projectId}
                task={task}
                isObservedTask={isObservedTask}
                isToReviewTask={isToReviewTask}
                isActiveOrganizeMode={isActiveOrganizeMode}
                provided={provided}
                dismissibleRef={dismissibleRef}
                taskItemRef={taskItemRef}
                toggleSubTaskList={toggleSubTaskList}
                subtaskList={subtaskList}
                isSuggested={isSuggested}
                checked={checked}
                showSubTaskList={showSubTaskList}
                setInEditMode={setInEditMode}
                setShowSubTaskIndicator={setShowSubTaskIndicator}
                inParentGoal={inParentGoal}
                isPending={isPending}
            />

            {(!isActiveOrganizeMode && showSubTaskList) ||
            (isActiveOrganizeMode && subtaskList.length > 0 && draggingParentTaskId === task.id) ? (
                <SubTasksView
                    hideSubtaskList={hideSubtaskList}
                    showSubtaskList={showSubtaskList}
                    projectId={projectId}
                    parentTask={task}
                    subtaskList={subtaskList}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    isPending={isPending}
                />
            ) : null}
        </View>
    )
}
