import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { getCalendarTagText } from './calendarTagHelper'

export default function CalendarTag({ calendarData, containerStyle }) {
    const dispatch = useDispatch()
    const reallySmallScreenNavigation = useSelector(state => state.reallySmallScreenNavigation)
    const timeFormat = getTimeFormat()
    const text = getCalendarTagText(calendarData, timeFormat, reallySmallScreenNavigation)

    const openLink = () => {
        dispatch(showFloatPopup())
        const separator = calendarData.link && calendarData.link.includes('?') ? '&' : '?'
        const url =
            calendarData.provider === 'microsoft'
                ? calendarData.link
                : calendarData.link + `${separator}authuser=${calendarData.email}`
        window.open(url, '_blank')
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
