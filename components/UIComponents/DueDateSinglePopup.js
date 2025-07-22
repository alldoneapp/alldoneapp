import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'
import Popover from 'react-tiny-popover'
import { hideFloatPopup, hideSwipeDueDatePopup, setSwipeDueDatePopupData } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { setTaskDueDate, setTaskToBacklog } from '../../utils/backends/Tasks/tasksFirestore'
import { checkIfInMyDayOpenTab } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

export default function DueDateSinglePopup() {
    const dispatch = useDispatch()
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const data = useSelector(state => state.showSwipeDueDatePopup.data)
    const [visibleCalendar, setVisibleCalendar] = useState(false)

    const inMyDayOpenTab = checkIfInMyDayOpenTab(
        selectedProjectIndex,
        showAllProjectsByTime,
        route,
        selectedSidebarTab,
        taskViewToggleIndex
    )

    if (!data || !data.task) return null // Ensure data and task exist before proceeding

    const { task, projectId, isObservedTask, isToReviewTask, multipleTasks, goal, parentGoaltasks, inParentGoal } = data

    const hidePopover = () => {
        if (!visibleCalendar) dispatch([hideFloatPopup(), hideSwipeDueDatePopup(), setSwipeDueDatePopupData(null)])
    }

    const delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
        setTimeout(async () => {
            hidePopover()
        })
    }

    const hideCalendar = () => {
        setVisibleCalendar(false)
    }

    const showCalendar = () => {
        setVisibleCalendar(true)
    }

    const updateParentGoalReminderDate = date => {
        Backend.updateGoalAssigneeReminderDate(projectId, goal.id, currentUserId, date)
    }

    const handleSaveTaskDate = async (taskToUpdate, dateTimestamp, isObservedTabActive) => {
        console.log(`[DueDateSinglePopup] handleSaveTaskDate called for task ${taskToUpdate.id}`)
        const moveObservedDateAndDueDate = isObservedTask && isToReviewTask

        if (moveObservedDateAndDueDate) {
            await setTaskDueDate(projectId, taskToUpdate.id, dateTimestamp, taskToUpdate, false, null)
            await setTaskDueDate(projectId, taskToUpdate.id, dateTimestamp, taskToUpdate, true, null)
        } else {
            setTaskDueDate(projectId, taskToUpdate.id, dateTimestamp, taskToUpdate, isObservedTabActive, null)
        }
    }

    const handleSetTaskToBacklog = async (taskToUpdate, isObservedTabActive) => {
        console.log(`[DueDateSinglePopup] handleSetTaskToBacklog called for task ${taskToUpdate.id}`)
        const moveObservedDateAndDueDate = isObservedTask && isToReviewTask

        if (moveObservedDateAndDueDate) {
            await setTaskToBacklog(projectId, taskToUpdate.id, taskToUpdate, false, null)
            await setTaskToBacklog(projectId, taskToUpdate.id, taskToUpdate, true, null)
        } else {
            setTaskToBacklog(projectId, taskToUpdate.id, taskToUpdate, isObservedTabActive, null)
        }
    }

    let sidebarOpenStyle = smallScreenNavigation ? null : { marginLeft: 300 }

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.popup, sidebarOpenStyle]}>
                <Popover
                    content={
                        <>
                            <DueDateModal
                                task={task}
                                projectId={projectId}
                                closePopover={delayHidePopover}
                                delayClosePopover={delayHidePopover}
                                hideCalendar={hideCalendar}
                                showCalendar={showCalendar}
                                isObservedTask={inMyDayOpenTab ? false : isObservedTask}
                                multipleTasks={multipleTasks}
                                tasks={parentGoaltasks}
                                inParentGoal={inParentGoal}
                                updateParentGoalReminderDate={goal ? updateParentGoalReminderDate : undefined}
                                saveDueDateBeforeSaveTask={
                                    multipleTasks ? handleSaveTaskDate : goal ? undefined : handleSaveTaskDate
                                }
                                setToBacklogBeforeSaveTask={
                                    multipleTasks ? handleSetTaskToBacklog : goal ? undefined : handleSetTaskToBacklog
                                }
                                goalCompletionDate={goal ? goal.completionMilestoneDate : undefined}
                                goalStartingDate={goal ? goal.startingMilestoneDate : undefined}
                                goal={goal}
                            />
                        </>
                    }
                    onClickOutside={delayHidePopover}
                    isOpen={true}
                    padding={4}
                    contentLocation={smallScreenNavigation ? null : undefined}
                >
                    <Text />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
    popup: {
        alignItems: 'center',
    },
})
