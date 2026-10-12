import React from 'react'
import { Text } from 'react-native'

// Backend and unrelated rich-text/capacity/calendar leaves only. The row's
// TouchableOpacity, Swipeable, popup, date choices and responsive shell are real.
export default function Leaf({ children }) {
    return children ? <Text>{children}</Text> : null
}
Leaf.checkIfLoggedUserIsNormalUserInGuide = () => false
Leaf.showWrappedTaskEllipsis = () => false
Leaf.watchMilestoneTasksStatistics = () => {}
Leaf.unwatch = () => {}
export const calculateAutomaticCapacity = () => 0
export const getGoalsAndAssigneesId = () => ({})
export const getMilestoneAssigneeCapacityDays = () => 0
export const checkIfAnyGoalsInMilestoneHasCapacity = () => false
export const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER
export const checkIfInMyDayOpenTab = () => false
export const postponeTaskWithMotion = (_context, write) => write()
export const postponeGoalWithMotion = (_context, write) => write()
export const watchGoal = () => {}
export const getPreviousMilestone = async () => null
export const setTaskDueDate = () => {
    throw new Error('Unexpected individual task write')
}
export const setTaskToBacklog = setTaskDueDate
export const postponeProjectTasks = async (projectId, date, mode) => {
    window.__writes.push({ projectId, date, mode })
    return { updatedTaskCount: 2 }
}
export const translate = key => (key === 'Reminder' ? 'Erinnerung' : key)
export const applyPopoverWidth = () => ({ width: Math.min(window.innerWidth - 32, 305) })
export const popoverToTopContainerStyle = { position: 'fixed' }
export const popoverToCenter = ({ popoverRect }) => ({
    top: (window.innerHeight - popoverRect.height) / 2,
    left: (window.innerWidth - popoverRect.width) / 2,
})
export const execShortcutFn = (_ref, action, event) => {
    event.preventDefault()
    action()
}
export const DUE_DATE_MODAL_ID = 'due-date'
export const storeModal = () => {}
export const removeModal = () => {}
export const exitsOpenModals = () => false
