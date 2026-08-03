import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

const STATUS_PRESENTATION = {
    pending: { label: 'Queued', icon: 'clock', color: colors.Text03 },
    running: { label: 'Working', icon: 'cpu', color: colors.UtilityBlue200 },
    awaiting_vm: { label: 'Working', icon: 'cpu', color: colors.UtilityBlue200 },
    failed: { label: 'Needs attention', icon: 'refresh-cw', color: colors.UtilityRed200 },
}

export default function AssistantWorkflowRunTag({ projectId, task, style }) {
    const [retrying, setRetrying] = useState(false)
    const presentation = STATUS_PRESENTATION[task?.workflowAiStatus?.status]
    if (!presentation || task?.done) return null

    const failed = task.workflowAiStatus.status === 'failed'
    const retry = async () => {
        if (!failed || retrying) return
        setRetrying(true)
        try {
            await runHttpsCallableFunction('retryWorkflowAiRunSecondGen', { projectId, taskId: task.id })
        } catch (error) {
            console.error('Could not retry assistant workflow run:', error)
        } finally {
            setRetrying(false)
        }
    }

    return (
        <TouchableOpacity
            style={[localStyles.container, { borderColor: presentation.color }, style]}
            onPress={retry}
            disabled={!failed || retrying}
            accessibilityRole={failed ? 'button' : 'text'}
            accessibilityLabel={failed ? translate('Retry assistant task') : translate(presentation.label)}
        >
            <Icon name={presentation.icon} size={12} color={presentation.color} />
            <Text style={[localStyles.text, { color: presentation.color }]}>
                {retrying ? translate('Queued') : translate(presentation.label)}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 22,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderWidth: 1,
        borderRadius: 11,
        marginRight: 8,
    },
    text: {
        ...styles.caption2,
        marginLeft: 4,
    },
})
