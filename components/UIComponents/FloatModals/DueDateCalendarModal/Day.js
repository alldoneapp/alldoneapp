import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../../../styles/global'
import moment from 'moment'
import { useDispatch } from 'react-redux'
import { setSelectedTasks, setLastSelectedDueDate } from '../../../../redux/actions'
import Backend from '../../../../utils/BackendBridge'
import { setTaskDueDate } from '../../../../utils/backends/Tasks/tasksFirestore'

export default function Day({
    date,
    disabled,
    currentDueDate,
    updateDate,
    task,
    projectId,
    saveDueDateBeforeSaveTask,
    tasks,
    multipleTasks,
    updateGoalMilestone,
    isObservedTabActive,
    closePopover,
    updateParentGoalReminderDate,
}) {
    const dispatch = useDispatch()

    const selectDate = (event, { year, month, day }) => {
        event.preventDefault()
        event.stopPropagation()

        let selectedDate = new Date(year, month - 1, day)
        let selectedMoment = moment(selectedDate)
        let dueDate = selectedDate.getTime()
        let today = moment()

        if (selectedMoment.isSameOrAfter(today, 'day')) {
            updateDate(dueDate)

            if (saveDueDateBeforeSaveTask) {
                saveDueDateBeforeSaveTask(dueDate, isObservedTabActive)
            } else if (task) {
                if (multipleTasks) {
                    Backend.setTaskDueDateMultiple(tasks, dueDate)
                    dispatch(setSelectedTasks(null, true))
                    if (updateParentGoalReminderDate) updateParentGoalReminderDate(dueDate)
                } else if (updateParentGoalReminderDate) {
                    updateParentGoalReminderDate(dueDate)
                } else {
                    setTaskDueDate(projectId, task.id, dueDate, task, isObservedTabActive, null)
                }
            } else if (updateGoalMilestone) {
                updateGoalMilestone(selectedMoment.hour(12).minute(0).valueOf())
            }
            closePopover()
            dispatch(setLastSelectedDueDate(dueDate))
            return false
        }
    }

    const onPress = event => {
        selectDate(event, date)
    }

    const dateObj = new Date(date.year, date.month - 1, date.day)
    const dateMoment = moment(dateObj)
    const today = moment()
    const isToday = dateMoment.isSame(today, 'day')
    const selected = moment(currentDueDate).isSame(dateMoment, 'day')
    return (
        <TouchableOpacity onPress={onPress}>
            <Text
                style={[
                    localStyles.dayElement,
                    disabled ? localStyles.dayDisabled : localStyles.dayNormal,
                    isToday && localStyles.today,
                    selected && localStyles.daySelected,
                ]}
            >
                {date.day}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    dayElement: {
        ...styles.body1,
        textAlign: 'center',
        width: 32,
        height: 32,
        borderWidth: 2,
        borderColor: 'transparent',
        paddingTop: 3,
        paddingBottom: 5,
        marginVertical: 0,
        marginHorizontal: 4,
    },
    dayDisabled: {
        color: colors.Text02,
    },
    dayNormal: {
        color: colors.Text03,
    },
    today: {
        color: '#ffffff',
    },
    daySelected: {
        borderWidth: 2,
        borderRadius: 4,
        borderColor: colors.Primary200,
        backgroundColor: colors.Secondary400,
        padding: 4,
    },
})
