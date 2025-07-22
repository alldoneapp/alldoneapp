import React, { useRef, useEffect, useState } from 'react'
import { View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import DismissibleItem from '../../UIComponents/DismissibleItem'
import TaskPresentation from '../TaskItem/TaskPresentation/TaskPresentation'
import { setCheckTaskItem } from '../../../redux/actions'
import ParentTaskContainer from '../../TaskListView/ParentTaskContainer'
import SharedHelper from '../../../utils/SharedHelper'
import AddTask from '../AddTask'
import store from '../../../redux/store'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import EditTask from '../TaskItem/EditTask'

export default function SubTasksView({
    projectId,
    hideSubtaskList,
    showSubtaskList,
    parentTask,
    subtaskList,
    isActiveOrganizeMode,
    isObservedTask,
    isToReviewTask,
    isPending,
}) {
    const dispatch = useDispatch()
    const checkTaskItem = useSelector(state => state.checkTaskItem)
    const focusedTaskItem = useSelector(state => state.focusedTaskItem)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const [firstLoadedEnded, setFirstLoadedEnded] = useState(false)

    const dismissibleRefs = useRef([])
    const taskItemRefs = useRef([])
    const newItemRef = useRef(null)
    const parentRefsList = useRef([])

    const setAriaTaskId = () => {
        for (let index in subtaskList) {
            const task = subtaskList[index]
            if (task && parentRefsList.current[index]) {
                parentRefsList.current[index].setNativeProps({ 'aria-task-id': task.id })
                parentRefsList.current[index].setNativeProps({ 'is-observed-task': isObservedTask ? 'true' : 'false' })
            }
        }
    }

    const openTaskModal = index => {
        dismissibleRefs.current[index].openModal()
    }

    const editModeCheckOff = index => {
        dismissibleRefs.current[index].toggleModal()
        setTimeout(() => {
            taskItemRefs.current[index].onCheckboxPress()
        }, 100)
    }

    const findTaskIndexById = taskId => {
        return subtaskList.findIndex(subT => subT.id === taskId)
    }

    useEffect(() => {
        if (subtaskList.length === 0) newItemRef.current.toggleModal()
        setFirstLoadedEnded(true)
    }, [])

    useEffect(() => {
        if (firstLoadedEnded && subtaskList.length === 0) hideSubtaskList()
        setAriaTaskId()
    }, [subtaskList.length])

    useEffect(() => {
        if (focusedTaskItem.isObserved === !!isObservedTask) {
            const index = findTaskIndexById(focusedTaskItem.id)
            const { activeEditMode } = store.getState()
            if (index > -1 && !activeEditMode) {
                openTaskModal(index)
            }
        }
    }, [focusedTaskItem.id, focusedTaskItem.isObserved])

    useEffect(() => {
        if (checkTaskItem.isObserved === !!isObservedTask) {
            const index = findTaskIndexById(checkTaskItem.id)
            if (index > -1) {
                dispatch(setCheckTaskItem('', false))
                const { activeEditMode } = store.getState()
                if (loggedUserIsParentTaskOwner)
                    activeEditMode ? editModeCheckOff(index) : taskItemRefs.current[index].onCheckboxPress()
            }
        }
    }, [checkTaskItem.id, checkTaskItem.isObserved])

    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, projectIds, projectId, false)

    const loggedUserIsParentTaskOwner = loggedUserId === parentTask.userId
    const loggedUserCanUpdateObject =
        loggedUserIsParentTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const parentInTaskOutOfOpen = isPending || isToReviewTask || parentTask.inDone

    return (
        <View style={{ marginLeft: 34 }}>
            {subtaskList.length > 0
                ? isActiveOrganizeMode
                    ? subtaskList.map(subTask => {
                          return (
                              <ParentTaskContainer
                                  key={subTask.id}
                                  task={subTask}
                                  projectId={projectId}
                                  isActiveOrganizeMode
                                  subtaskList={[]}
                                  isObservedTask={isObservedTask}
                                  isToReviewTask={isToReviewTask}
                              />
                          )
                      })
                    : subtaskList.map((subTask, index) => {
                          return (
                              <View key={subTask.id} ref={ref => (parentRefsList.current[index] = ref)}>
                                  <DismissibleItem
                                      ref={ref => (dismissibleRefs.current[index] = ref)}
                                      defaultComponent={
                                          <TaskPresentation
                                              ref={ref => (taskItemRefs.current[index] = ref)}
                                              projectId={projectId}
                                              parentTask={parentTask}
                                              task={subTask}
                                              toggleModal={() => {
                                                  dismissibleRefs.current[index]?.toggleModal()
                                              }}
                                              isPending={isPending}
                                              isToReviewTask={isToReviewTask}
                                              isObservedTask={isObservedTask}
                                          />
                                      }
                                      modalComponent={
                                          <EditTask
                                              isSubtask={true}
                                              parentTask={parentTask}
                                              task={subTask}
                                              projectId={projectId}
                                              onCancelAction={forceAction => {
                                                  dismissibleRefs.current[index]?.toggleModal(forceAction)
                                              }}
                                              editModeCheckOff={() => editModeCheckOff(index)}
                                              isObservedTask={isObservedTask}
                                              isToReviewTask={isToReviewTask}
                                              isPending={isPending}
                                          />
                                      }
                                  />
                              </View>
                          )
                      })
                : null}

            {!isActiveOrganizeMode && accessGranted && loggedUserCanUpdateObject && (
                <DismissibleItem
                    ref={newItemRef}
                    defaultComponent={
                        <AddTask
                            projectId={projectId}
                            isSubtask={true}
                            parentTask={parentTask}
                            newItem
                            toggleModal={() => {
                                newItemRef.current.toggleModal()
                            }}
                        />
                    }
                    modalComponent={
                        <EditTask
                            adding={true}
                            isSubtask={true}
                            subtaskList={subtaskList ? subtaskList : []}
                            parentTask={parentTask}
                            projectId={projectId}
                            onCancelAction={forceAction => {
                                newItemRef.current.toggleModal(forceAction)
                            }}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            defaultDate={parentTask.dueDate}
                            parentInTaskOutOfOpen={parentInTaskOutOfOpen}
                        />
                    }
                    onToggleModal={
                        subtaskList.length === 0
                            ? value => {
                                  value ? showSubtaskList() : hideSubtaskList()
                              }
                            : undefined
                    }
                />
            )}
        </View>
    )
}
