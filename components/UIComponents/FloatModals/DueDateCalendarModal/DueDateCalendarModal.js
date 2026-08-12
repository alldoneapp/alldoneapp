import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'
import { colors } from '../../../styles/global'
import moment from 'moment'
import AppCalendar from '../../Calendar/AppCalendar'
import Day from './Day'
import { applyDaySelection } from './daySelection'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

export default function DueDateCalendarModal({
    task,
    inParentGoal,
    isObservedTabActive,
    initialDate,
    externalStyle,
    projectId,
    saveDueDateBeforeSaveTask,
    tasks,
    multipleTasks,
    updateGoalMilestone,
    closePopover,
    updateParentGoalReminderDate,
}) {
    const dispatch = useDispatch()
    const [currentDueDate, setCurrentDueDate] = useState(
        initialDate === BACKLOG_DATE_NUMERIC ? Date.now() : initialDate
    )

    const dateString = moment(currentDueDate).format('YYYY-MM-DD')

    useEffect(() => {
        setCurrentDueDate(initialDate === BACKLOG_DATE_NUMERIC ? Date.now() : initialDate)
    }, [initialDate])

    const onSelectDate = date => {
        const applied = applyDaySelection(date, {
            dispatch,
            updateDate: setCurrentDueDate,
            saveDueDateBeforeSaveTask,
            task,
            tasks,
            multipleTasks,
            projectId,
            isObservedTabActive,
            updateGoalMilestone,
            updateParentGoalReminderDate,
        })
        if (applied) closePopover()
    }

    return (
        <View style={[localStyles.calendarContainer, externalStyle]}>
            <AppCalendar
                current={dateString}
                minDate={moment().format('YYYY-MM-DD')}
                markingType={'custom'}
                markedDates={{
                    [dateString]: {
                        customStyles: customStylesMarkedDatesCalendar,
                        marked: true,
                        selected: false,
                    },
                }}
                style={localStyles.calendar}
                dayComponent={({ date, state }) => {
                    return (
                        <Day
                            date={date}
                            currentDueDate={currentDueDate}
                            disabled={state === 'disabled'}
                            onSelectDate={onSelectDate}
                        />
                    )
                }}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    calendarContainer: {
        marginTop: -10,
    },
    calendar: {
        marginLeft: 16,
        marginRight: 16,
        paddingLeft: 0,
        paddingRight: 0,
    },
    today: {
        color: '#ffffff',
    },
})

const customStylesMarkedDatesCalendar = {
    container: {
        width: 32,
        height: 32,
        borderWidth: 2,
        borderRadius: 4,
        borderColor: colors.Primary200,
        backgroundColor: colors.Secondary400,
        padding: 4,
    },
    text: {
        marginTop: 0,
    },
}
