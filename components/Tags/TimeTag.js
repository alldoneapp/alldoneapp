import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

export default function TimeTag({ time, containerStyle, onPress, disabled }) {
    const reallySmallScreenNavigation = useSelector(state => state.reallySmallScreenNavigation)

    const { startDate, endDate } = time

    const timeFormat = getTimeFormat()

    const text = reallySmallScreenNavigation
        ? `${startDate.format(timeFormat)}`
        : `${startDate.format(timeFormat)} - ${endDate.format(timeFormat)}`

    return (
        <TouchableOpacity disabled={disabled} onPress={onPress} style={[localStyles.container, containerStyle]}>
            <Icon name={'calendar'} size={16} color={colors.Text03} style={localStyles.icon} />
            <Text style={[localStyles.text, windowTagStyle()]}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
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
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
