import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'

import global, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

// Lazy, like the URL system below: the backend module pulls in the redux store and the Firebase client.
const performEmailLineAction = (...args) =>
    require('../../../utils/backends/EmailLine/emailLineBackend').performEmailLineAction(...args)

function normalizeTask(task) {
    if (!task?.taskId || !task?.projectId) return null
    return task
}

// Several buttons can stand for the same email at once (the unread row and the email in its thread,
// AT-3165). Concurrent presses for the same message share one request; the server also returns the
// existing task for an email that already has one, so a later press never creates a second task.
const createTaskRequestsInFlight = new Map()

export function requestEmailTaskCreation(connectionId, payload) {
    const key = `${connectionId}:${[...payload.messageIds].sort().join('|')}`
    const existingRequest = createTaskRequestsInFlight.get(key)
    if (existingRequest) return existingRequest
    const request = performEmailLineAction(connectionId, payload)
    createTaskRequestsInFlight.set(key, request)
    const clear = () => {
        if (createTaskRequestsInFlight.get(key) === request) createTaskRequestsInFlight.delete(key)
    }
    request.then(clear, clear)
    return request
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
    onTaskCreated,
    style,
    // The idle label, e.g. 'Create email task' for the unread row (AT-3165).
    createLabelKey = 'Create task',
}) {
    const normalizedMessageIds = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean))]
    const messageIdsKey = normalizedMessageIds.join('|')
    const normalizedInitialTask = normalizeTask(initialTask)
    const [taskState, setTaskState] = useState(normalizedInitialTask ? 'done' : 'idle')
    const [createdTask, setCreatedTask] = useState(normalizedInitialTask)
    const creationInFlightRef = useRef(false)

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
        performEmailLineAction(connectionId, {
            action: 'getTaskForEmail',
            messageIds: normalizedMessageIds,
        })
            .then(result => {
                if (cancelled) return
                const existingTask = normalizeTask(result?.taskCreated)
                // The lookup only upgrades locally unknown state. A negative/failed
                // response must not hide or block Create, nor overwrite a task creation
                // that the user started while this background request was in flight.
                if (existingTask && !creationInFlightRef.current) {
                    setCreatedTask(currentTask => currentTask || existingTask)
                    setTaskState('done')
                }
            })
            .catch(() => {})

        return () => {
            cancelled = true
        }
    }, [checkExisting, connectionId, initialTask?.taskId, initialTask?.projectId, messageIdsKey])

    const createTask = async () => {
        if (!connectionId || normalizedMessageIds.length === 0 || creationInFlightRef.current) return
        creationInFlightRef.current = true
        setTaskState('creating')
        try {
            const result = await requestEmailTaskCreation(connectionId, {
                action: 'createTask',
                messageIds: normalizedMessageIds,
                labelId,
                labelName,
            })
            const task = normalizeTask(result)
            setCreatedTask(task)
            setTaskState(task ? 'done' : 'error')
            if (task && typeof onTaskCreated === 'function') {
                try {
                    await onTaskCreated(task)
                } catch (error) {
                    // The task already exists at this point, so a secondary UI-side effect must
                    // not turn the successful creation into a retryable Create button.
                    if (__DEV__) console.warn('[EmailTaskAction] Post-create action failed:', error?.message || error)
                }
            }
        } catch (error) {
            setTaskState('error')
        } finally {
            creationInFlightRef.current = false
        }
    }

    const openCreatedTask = () => {
        if (!createdTask) return
        // Lazy: the URL system pulls in the router, the store and the Firebase client. The button is
        // rendered in chat-list rows (AT-3165), whose tests should not need any of that.
        const URLTrigger = require('../../../URLSystem/URLTrigger').default
        const NavigationService = require('../../../utils/NavigationService').default
        const { getDvMainTabLink } = require('../../../utils/LinkingHelper')
        URLTrigger.processUrl(NavigationService, getDvMainTabLink(createdTask.projectId, createdTask.taskId, 'tasks'))
    }

    const done = taskState === 'done'
    const loading = taskState === 'creating'
    const labelKey = done ? 'Task created' : createLabelKey
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
