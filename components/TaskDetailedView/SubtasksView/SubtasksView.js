import React, { useState, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import SubtasksHeader from './SubtasksHeader'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import DismissibleItem from '../../UIComponents/DismissibleItem'
import TaskPresentation from '../../TaskListView/TaskItem/TaskPresentation/TaskPresentation'
import { DV_TAB_TASK_SUBTASKS } from '../../../utils/TabNavigationConstants'
import URLsTasks, { URL_TASK_DETAILS_SUBTASKS } from '../../../URLSystem/Tasks/URLsTasks'
import Backend from '../../../utils/BackendBridge'
import AddTask from '../../TaskListView/AddTask'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import EditTask from '../../TaskListView/TaskItem/EditTask'

export default function SubtasksView({ task, projectId }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const [subtasksList, setSubtasksList] = useState([])
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const dismissibleRefs = useRef([])
    const taskItemRefs = useRef([])
    const newItemRef = useRef()

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_SUBTASKS) {
            const data = { projectId: projectId, task: task.id }
            URLsTasks.push(URL_TASK_DETAILS_SUBTASKS, data, projectId, task.id)
        }
    }

    const editModeCheckOff = index => {
        dismissibleRefs.current[index].toggleModal()
        setTimeout(() => {
            taskItemRefs.current[index].onCheckboxPress()
        }, 100)
    }

    useEffect(() => {
        writeBrowserURL()
        Backend.watchSubtasksList(projectId, task.id, setSubtasksList)
        return () => {
            Backend.unwatchSubtasksList(task.id)
        }
    }, [])

    const loggedUserIsTaskOwner = task.userId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isToReviewTask = task.userIds.length > 1 && !task.inDone
    const parentInTaskOutOfOpen = isToReviewTask || task.inDone

    return (
        <View>
            <SubtasksHeader subtaskAmount={subtasksList.length} />

            <View>
                {subtasksList.map((subTask, index) => {
                    return (
                        <View key={subTask.id}>
                            <DismissibleItem
                                ref={ref => (dismissibleRefs.current[index] = ref)}
                                defaultComponent={
                                    <TaskPresentation
                                        ref={ref => (taskItemRefs.current[index] = ref)}
                                        projectId={projectId}
                                        parentTask={task}
                                        task={subTask}
                                        toggleModal={() => {
                                            accessGranted && dismissibleRefs.current[index]?.toggleModal()
                                        }}
                                        isToReviewTask={isToReviewTask}
                                    />
                                }
                                modalComponent={
                                    <EditTask
                                        isSubtask={true}
                                        parentTask={task}
                                        task={subTask}
                                        projectId={projectId}
                                        onCancelAction={() => {
                                            dismissibleRefs.current[index]?.toggleModal()
                                        }}
                                        editModeCheckOff={() => editModeCheckOff(index)}
                                        isToReviewTask={isToReviewTask}
                                    />
                                }
                            />
                        </View>
                    )
                })}

                {accessGranted && loggedUserCanUpdateObject && (
                    <DismissibleItem
                        ref={newItemRef}
                        defaultComponent={
                            <AddTask
                                projectId={projectId}
                                isSubtask={true}
                                parentTask={task}
                                newItem
                                toggleModal={() => {
                                    newItemRef?.current?.toggleModal()
                                }}
                            />
                        }
                        modalComponent={
                            <EditTask
                                adding={true}
                                isSubtask={true}
                                subTasksList={subtasksList}
                                parentTask={task}
                                projectId={projectId}
                                onCancelAction={() => {
                                    newItemRef?.current?.toggleModal()
                                }}
                                defaultDate={task.dueDate}
                                parentInTaskOutOfOpen={parentInTaskOutOfOpen}
                            />
                        }
                    />
                )}
            </View>
        </View>
    )
}
