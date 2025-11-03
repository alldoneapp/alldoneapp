import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import AlertTimeButton from '../../UIControls/AlertTimeButton'

export default function AlertTime({ projectId, task, disabled }) {
    // Alert requires a reminder date to be set
    const hasReminder = task && task.dueDate
    const isDisabled = disabled || !hasReminder

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="bell" size={24} color={isDisabled ? colors.Text04 : colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: isDisabled ? colors.Text04 : colors.Text03 }]}>
                {translate('Alert')}
            </Text>
            <View style={{ marginLeft: 'auto' }}>
                <AlertTimeButton projectId={projectId} task={task} disabled={isDisabled} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
