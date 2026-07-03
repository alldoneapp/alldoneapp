import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../Icon'
import styles from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getTaskPriorityLabel, TASK_PRIORITY_NONE, normalizeTaskPriority } from '../../utils/TaskPriority'
import { getTaskPriorityColors } from '../TaskListView/Utils/TaskPriorityPresentation'

export default function TaskPriorityTag({ priority, style }) {
    const normalizedPriority = normalizeTaskPriority(priority)
    if (normalizedPriority === TASK_PRIORITY_NONE) return null

    const priorityColors = getTaskPriorityColors(normalizedPriority)

    return (
        <View style={[localStyles.container, { backgroundColor: priorityColors.backgroundColor }, style]}>
            <Icon name={'flag'} size={14} color={priorityColors.foregroundColor} />
            <Text style={[localStyles.text, { color: priorityColors.foregroundColor }]}>
                {translate(getTaskPriorityLabel(normalizedPriority))}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 8,
    },
    text: {
        ...styles.subtitle2,
        marginLeft: 4,
    },
})
