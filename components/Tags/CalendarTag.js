import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import moment from 'moment'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { getCalendarTaskStartAndEndTimestamp } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksIntervals'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'

export default function CalendarTag({ calendarData, containerStyle }) {
    const dispatch = useDispatch()
    const reallySmallScreenNavigation = useSelector(state => state.reallySmallScreenNavigation)
    const firstLoginDateInDay = useSelector(state => state.loggedUser.firstLoginDateInDay)

    const timeFormat = getTimeFormat()

    const getDates = () => {
        if (calendarData.start.dateTime && calendarData.start.endTime) {
            return {
                startDate: moment(calendarData.start.dateTime),
                endDate: moment(calendarData.start.endTime),
            }
        } else {
            const endTimeForAllDayCalendarTasks = moment(firstLoginDateInDay).add(8, 'hours').valueOf()
            const { startDateTimestamp, endDateTimestamp } = getCalendarTaskStartAndEndTimestamp(
                calendarData,
                firstLoginDateInDay,
                endTimeForAllDayCalendarTasks
            )
            return {
                startDate: moment(startDateTimestamp),
                endDate: moment(endDateTimestamp),
            }
        }
    }

    const { startDate, endDate } = getDates()
    const text = reallySmallScreenNavigation
        ? `${startDate.format(timeFormat)}`
        : `${startDate.format(timeFormat)} - ${endDate.format(timeFormat)}`

    const openLink = () => {
        dispatch(showFloatPopup())
        window.open(calendarData.link + `&authuser=${calendarData.email}`, '_blank')
        setTimeout(() => {
            dispatch(hideFloatPopup())
        })
    }

    return (
        <TouchableOpacity onPress={openLink} style={[localStyles.container, containerStyle]}>
            <Icon name={'calendar'} size={16} color={colors.Gray300} style={localStyles.icon} />
            <Text style={[localStyles.text, windowTagStyle()]}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Text03,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Gray300,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
