import React, { useState, useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'
import AppPopover from './ModalShell/AppPopover'
import useModalSizing from '../../hooks/useModalSizing'
import { hideFloatPopup, hideSwipeDueDatePopup, setSwipeDueDatePopupData } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { setTaskDueDate, setTaskToBacklog } from '../../utils/backends/Tasks/tasksFirestore'
import { checkIfInMyDayOpenTab } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import { popoverToCenter, popoverToTopContainerStyle } from '../../utils/HelperFunctions'

// This popup is mounted from inside a swipe RELEASE handler (Swipeable's
// onSwipeableRightWillOpen, see TaskPresentation/GoalItemPresentation/
// SwipeableGeneralTasksHeader). On touch devices the browser then replays that
// same gesture as compatibility mouse events (mousedown/mouseup/click) at the
// release point — by which time the popup is already mounted and
// react-tiny-popover is listening on `window` for a click outside its portal.
// The replayed click lands on this component's own transparent full-screen
// overlay, i.e. "outside", so the popup was dismissed in the very frame it
// appeared and never became visible on mobile (AT-2189).
//
// Swallow at most ONE outside dismiss, and only in the short window right after
// opening. Consume-once (rather than a plain time window) does not depend on how
// far apart the touch release and the replayed click land, and the window keeps
// it from ever eating a genuine outside tap on platforms that never replay one
// — desktop mouse dismissal is unchanged.
export const OPENING_GESTURE_REPLAY_WINDOW_MS = 400

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
    const { isSheet } = useModalSizing()
    const [visibleCalendar, setVisibleCalendar] = useState(false)
    const openedAtRef = useRef(Date.now())
    const openingDismissConsumedRef = useRef(false)

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

    // See OPENING_GESTURE_REPLAY_WINDOW_MS above. Only guards the outside-click
    // path; picking a date still closes the popup immediately.
    const isOpeningGestureReplay = () => {
        if (openingDismissConsumedRef.current) return false
        openingDismissConsumedRef.current = true
        return Date.now() - openedAtRef.current < OPENING_GESTURE_REPLAY_WINDOW_MS
    }

    const onClickOutside = () => {
        // In sheet mode the BottomSheet's own AT-2236 mount grace already
        // blocks the replayed compatibility click; running this guard on top
        // would swallow the first GENUINE backdrop tap within the window.
        if (!isSheet && isOpeningGestureReplay()) return
        delayHidePopover()
    }

    const hideCalendar = () => {
        setVisibleCalendar(false)
    }

    const showCalendar = () => {
        setVisibleCalendar(true)
    }

    const updateParentGoalReminderDate = date => {
        // AT-2160: hand over the goal we already hold. Without it the backend does a full
        // getGoalData() read before it can write, so every goal postpone from this popup paid for
        // a round trip before the row could move.
        Backend.updateGoalAssigneeReminderDate(projectId, goal.id, currentUserId, date, goal)
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

    return (
        // In sheet mode the transparent centering overlay must not intercept
        // pointer events: it sits ABOVE the sheet's backdrop (10000 vs 9990)
        // and would eat every backdrop tap. It only exists to center the
        // zero-size desktop anchor.
        <View style={[localStyles.container, isSheet && NO_POINTER_EVENTS_STYLE]}>
            <View style={localStyles.popup}>
                <AppPopover
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
                    onClickOutside={onClickOutside}
                    isOpen={true}
                    padding={4}
                    contentLocation={popoverData => popoverToCenter(popoverData, smallScreenNavigation)}
                    containerStyle={popoverToTopContainerStyle}
                >
                    <Text />
                </AppPopover>
            </View>
        </View>
    )
}

const NO_POINTER_EVENTS_STYLE = { pointerEvents: 'none' }

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
