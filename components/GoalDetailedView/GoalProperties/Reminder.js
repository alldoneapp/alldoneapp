import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Backend from '../../../utils/BackendBridge'
import { translate } from '../../../i18n/TranslationService'
import ReminderWrapper from './ReminderWrapper'
import { useSelector } from 'react-redux'

export default function Reminder({ goal, projectId, disabled }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const reminderDate = goal.assigneesReminderDate[loggedUserId]

    const updateReminder = date => {
        if (reminderDate !== date) Backend.updateGoalAssigneeReminderDate(projectId, goal.id, loggedUserId, date)
    }

    return (
        <View style={localStyles.container}>
            <Icon name="calendar" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Reminder')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <ReminderWrapper
                    projectId={projectId}
                    updateReminder={updateReminder}
                    reminderDate={reminderDate}
                    disabled={disabled || !reminderDate}
                    goal={goal}
                />
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
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    button: {
        marginHorizontal: 0,
    },
})
