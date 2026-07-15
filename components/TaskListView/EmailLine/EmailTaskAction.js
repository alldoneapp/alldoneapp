import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'

import global, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'

function normalizeTask(task) {
    if (!task?.taskId || !task?.projectId) return null
    return task
}

export default function EmailTaskAction({
    connectionId,
    messageIds,
    initialTask,
    labelId = null,
    labelName = null,
    checkExisting = false,
    compact = false,
    iconColor = colors.Text03,
    borderColor = colors.Gray300,
    textColor = colors.Text03,
    style,
}) {
    const normalizedMessageIds = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean))]
    const messageIdsKey = normalizedMessageIds.join('|')
    const normalizedInitialTask = normalizeTask(initialTask)
    const [taskState, setTaskState] = useState(normalizedInitialTask ? 'done' : checkExisting ? 'checking' : 'idle')
    const [createdTask, setCreatedTask] = useState(normalizedInitialTask)

    useEffect(() => {
        const nextInitialTask = normalizeTask(initialTask)
        if (nextInitialTask) {
            setCreatedTask(nextInitialTask)
            setTaskState('done')
            return undefined
        }

        setCreatedTask(null)
        if (!checkExisting || !connectionId || normalizedMessageIds.length === 0) {
            setTaskState('idle')
            return undefined
        }

        let cancelled = false
        setTaskState('checking')
        performEmailLineAction(connectionId, {
            action: 'getTaskForEmail',
            messageIds: normalizedMessageIds,
        })
            .then(result => {
                if (cancelled) return
                const existingTask = normalizeTask(result?.taskCreated)
                setCreatedTask(existingTask)
                setTaskState(existingTask ? 'done' : 'idle')
            })
            .catch(() => {
                if (!cancelled) setTaskState('idle')
            })

        return () => {
            cancelled = true
        }
    }, [checkExisting, connectionId, initialTask?.taskId, initialTask?.projectId, messageIdsKey])

    const createTask = async () => {
        if (!connectionId || normalizedMessageIds.length === 0 || taskState === 'creating') return
        setTaskState('creating')
        try {
            const result = await performEmailLineAction(connectionId, {
                action: 'createTask',
                messageIds: normalizedMessageIds,
                labelId,
                labelName,
            })
            const task = normalizeTask(result)
            setCreatedTask(task)
            setTaskState(task ? 'done' : 'error')
        } catch (error) {
            setTaskState('error')
        }
    }

    const openCreatedTask = () => {
        if (!createdTask) return
        URLTrigger.processUrl(NavigationService, getDvMainTabLink(createdTask.projectId, createdTask.taskId, 'tasks'))
    }

    const done = taskState === 'done'
    const loading = taskState === 'checking' || taskState === 'creating'
    const labelKey = taskState === 'checking' ? 'Loading' : done ? 'Task created' : 'Create task'
    const accessibilityLabel = translate(labelKey)

    return (
        <TouchableOpacity
            style={[
                localStyles.button,
                compact ? localStyles.compactButton : { borderColor },
                !compact && localStyles.labeledButton,
                style,
            ]}
            onPress={done ? openCreatedTask : createTask}
            disabled={loading || (done && !createdTask)}
            accessibilityLabel={accessibilityLabel}
        >
            {loading ? (
                <ActivityIndicator size="small" color={iconColor} />
            ) : (
                <Icon
                    name={done ? 'check-square' : 'plus-square'}
                    size={compact ? 16 : 14}
                    color={done ? colors.UtilityGreen300 : taskState === 'error' ? colors.UtilityRed200 : iconColor}
                />
            )}
            {!compact && <Text style={[localStyles.buttonText, { color: textColor }]}>{translate(labelKey)}</Text>}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    compactButton: {
        width: 32,
        height: 32,
    },
    labeledButton: {
        minHeight: 28,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
    },
    buttonText: {
        ...global.caption2,
        marginLeft: 6,
    },
})
