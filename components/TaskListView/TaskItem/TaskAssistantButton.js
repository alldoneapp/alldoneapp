import React from 'react'
import { StyleSheet } from 'react-native'

import { colors } from '../../styles/global'
import DvBotButton from '../../UIControls/DvBotButton'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'

export default function TaskAssistantButton({ projectId, task, disabled }) {
    return (
        <DvBotButton
            style={[localStyles.button, disabled && localStyles.buttonDisabled]}
            navItem={DV_TAB_TASK_CHAT}
            projectId={projectId}
            assistantId={task?.assistantId || ''}
            objectId={task?.id}
            objectType="tasks"
            parentObject={task}
            resolveProjectAssistant={true}
            disabled={disabled}
            stopPressPropagation={true}
            hotkey="alt+a"
        />
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 24,
        height: 24,
        minHeight: 24,
        maxHeight: 24,
        marginRight: 0,
        padding: 0,
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderWidth: 0,
        borderRadius: 6,
        backgroundColor: colors.Primary050,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
})
