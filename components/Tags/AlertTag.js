import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import moment from 'moment'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../i18n/TranslationService'

export default function AlertTag({ task, containerStyle, onPress, disabled }) {
    if (!task?.alertEnabled || !task?.dueDate) {
        return null
    }

    const timeFormat = getTimeFormat()
    const alertTime = moment(task.dueDate).format(timeFormat)

    return (
        <TouchableOpacity disabled={disabled} onPress={onPress} style={[localStyles.container, containerStyle]}>
            <Icon name={'bell'} size={16} color={colors.Secondary400} style={localStyles.icon} />
            <Text style={[localStyles.text, windowTagStyle()]}>{alertTime}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Warning500, // Distinct color for alerts (orange/amber)
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
        color: colors.Secondary400, // Dark text on light/warning background
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
        fontWeight: '600',
    },
})
