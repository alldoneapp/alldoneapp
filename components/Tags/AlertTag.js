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
            <Icon name={'bell'} size={16} color={colors.Gray300} style={localStyles.icon} />
            <Text style={[localStyles.text, windowTagStyle()]}>{alertTime}</Text>
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
