import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'
import {
    EXECUTION_STATE_ACTIVE,
    EXECUTION_STATE_AWAITING_USER,
    EXECUTION_STATE_LABELS,
    EXECUTION_STATE_NEEDS_ATTENTION,
    EXECUTION_STATE_PAUSED,
    EXECUTION_STATE_QUEUED,
    resolveTaskExecutionStatus,
} from './taskExecutionStatus'

/**
 * AT-3099 — the single execution status chip of a task row. Replaces the pair of the workflow-run
 * chip (`AssistantWorkflowRunTag`) and the VM-session pill (`InProgressVmTag`); see
 * `taskExecutionStatus.js` for how the two sources resolve to one state. It keeps the subtle outline
 * style with icon that the workflow-run chip had, and puts the technical VM details in the tooltip.
 */

const STATE_PRESENTATION = {
    [EXECUTION_STATE_AWAITING_USER]: { icon: 'message-circle', color: colors.UtilityYellow300 },
    [EXECUTION_STATE_ACTIVE]: { icon: 'cpu', color: colors.UtilityBlue200 },
    [EXECUTION_STATE_QUEUED]: { icon: 'clock', color: colors.Text03 },
    [EXECUTION_STATE_NEEDS_ATTENTION]: { icon: 'alert-circle', color: colors.UtilityRed200 },
    [EXECUTION_STATE_PAUSED]: { icon: 'pause-circle', color: colors.Text03 },
}

const translateDetail = ({ key, params }) =>
    params?.stateKey ? translate(key, { state: translate(params.stateKey) }) : translate(key, params)

export const buildExecutionStatusTooltip = (status, label) => {
    const lines = [label, ...status.details.map(translateDetail)]
    if (status.retryable) lines.push(translate('Retry assistant task'))
    return lines.join('\n')
}

export function TaskExecutionStatusChip({ projectId, task, session, style }) {
    const [retrying, setRetrying] = useState(false)
    const status = resolveTaskExecutionStatus({ task, session })
    const label = status ? translate(EXECUTION_STATE_LABELS[status.state]) : ''
    const tooltip = status ? buildExecutionStatusTooltip(status, label) : ''

    // react-native-web does not forward `title`, so the tooltip is set on the DOM node directly
    // (same as PremiumBar).
    const setTooltip = useCallback(node => node?.setAttribute?.('title', tooltip), [tooltip])

    if (!status) return null

    const presentation = STATE_PRESENTATION[status.state]
    const retryable = status.retryable
    const retry = async () => {
        if (!retryable || retrying) return
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
            ref={setTooltip}
            testID="task-execution-status-tag"
            style={[localStyles.container, { borderColor: presentation.color }, style]}
            onPress={retry}
            disabled={!retryable || retrying}
            accessibilityRole={retryable ? 'button' : 'text'}
            accessibilityLabel={retryable ? translate('Retry assistant task') : label}
            accessibilityHint={tooltip}
        >
            <Icon name={retryable ? 'refresh-cw' : presentation.icon} size={12} color={presentation.color} />
            <Text style={[localStyles.text, { color: presentation.color }]}>
                {retrying ? translate('Queued') : label}
            </Text>
        </TouchableOpacity>
    )
}

export default function TaskExecutionStatusTag({ projectId, task, style }) {
    const [session, setSession] = useState(null)
    const taskId = task?.id
    // A task whose thread never hosted a VM job has no session to watch (AT-2907).
    const hasVmSession = task?.hasVmSession === true

    useEffect(() => {
        setSession(null)
        if (!hasVmSession) return undefined
        return watchVmSessionStatus(projectId, taskId, setSession)
    }, [projectId, taskId, hasVmSession])

    return <TaskExecutionStatusChip projectId={projectId} task={task} session={session} style={style} />
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
