import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../../../styles/global'
import moment from 'moment'

/**
 * Presentational day cell for the due-date calendar. It renders and reports
 * the press — nothing else. The decision tree that used to live here
 * (Firestore writes, redux dispatches, the goal/task/multi-select branching)
 * moved to daySelection.js and runs in DueDateCalendarModal's onSelectDate,
 * which is what lets the shared AppCalendar treat this like any other cell.
 */
export default function Day({ date, disabled, currentDueDate, onSelectDate }) {
    const onPress = event => {
        event.preventDefault()
        event.stopPropagation()
        onSelectDate(date)
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
