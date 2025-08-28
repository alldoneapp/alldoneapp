import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import AddPreConfigTaskWrapper from './AddPreConfigTaskWrapper'
import Icon from '../../../Icon'
import { TASK_TYPE_PROMPT } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'

export default function PreConfigTaskItem({ disabled, projectId, task, assistantId }) {
    const { name, type } = task

    const rowStyle = [
        localStyles.fullRowClickable,
        disabled && { opacity: 0.5 }, // Apply opacity if disabled
    ]

    return (
        <AddPreConfigTaskWrapper
            disabled={disabled}
            projectId={projectId}
            assistantId={assistantId}
            task={task}
            adding={false}
        >
            <View style={rowStyle}>
                <Icon
                    name={type === TASK_TYPE_PROMPT ? 'cpu' : 'bookmark'}
                    size={24}
                    color={colors.Text03}
                    style={localStyles.leadingIcon}
                />
                <Text style={localStyles.taskNameText} numberOfLines={1}>
                    {name}
                </Text>
                <Icon name="edit" size={20} color={colors.Text03} style={localStyles.trailingEditIcon} />
            </View>
        </AddPreConfigTaskWrapper>
    )
}

const localStyles = StyleSheet.create({
    fullRowClickable: {
        flexDirection: 'row',
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        paddingLeft: 8,
        paddingRight: 16, // To ensure space for the trailing edit icon within clickable area
        paddingVertical: 8,
        alignItems: 'center',
        width: '100%',
    },
    leadingIcon: {
        marginRight: 8,
    },
    taskNameText: {
        ...styles.subtitle2,
        color: colors.Text03,
        flex: 1, // Takes available space, pushing the edit icon to the right
        marginRight: 8, // Space between text and edit icon
    },
    trailingEditIcon: {
        // No specific styles needed here as flex layout handles positioning
    },
})
