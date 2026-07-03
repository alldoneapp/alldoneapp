import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { getTaskPriorityLabel, TASK_PRIORITY_NONE, normalizeTaskPriority } from '../../../../utils/TaskPriority'
import { getTaskPriorityColors } from '../../../TaskListView/Utils/TaskPriorityPresentation'

export default function TaskPriorityButton({ priority, disabled, onPress }) {
    const normalizedPriority = normalizeTaskPriority(priority)
    const priorityColors = getTaskPriorityColors(normalizedPriority)

    return (
        <Button
            type={'ghost'}
            icon={
                normalizedPriority === TASK_PRIORITY_NONE ? (
                    'flag'
                ) : (
                    <View style={[localStyles.dot, { backgroundColor: priorityColors.foregroundColor }]} />
                )
            }
            title={translate(getTaskPriorityLabel(normalizedPriority))}
            onPress={onPress}
            disabled={disabled}
        />
    )
}

const localStyles = StyleSheet.create({
    dot: {
        width: 16,
        height: 16,
        borderRadius: 8,
    },
})
