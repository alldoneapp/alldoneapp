import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import AddPreConfigTaskWrapper from './AddPreConfigTaskWrapper'
import Icon from '../../../Icon'
import Avatar from '../../../Avatar'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import {
    TASK_TYPE_PROMPT,
    TASK_TYPE_EXTERNAL_LINK,
    TASK_TYPE_WEBHOOK,
    TASK_TYPE_IFRAME,
} from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { getRecurrenceInfo, RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PreConfigTaskItem({ disabled, projectId, task, assistantId }) {
    const { name, type } = task

    const rowStyle = [localStyles.fullRowClickable, disabled && { opacity: 0.5 }]

    const recurrenceByUser = task?.recurrenceByUser || {}
    const groupedByRecurrence = {}

    Object.entries(recurrenceByUser).forEach(([userId, recurrence]) => {
        if (!recurrence || recurrence === RECURRENCE_NEVER) return
        if (!groupedByRecurrence[recurrence]) groupedByRecurrence[recurrence] = []
        groupedByRecurrence[recurrence].push(userId)
    })

    if (Object.keys(groupedByRecurrence).length === 0 && task.recurrence && task.recurrence !== RECURRENCE_NEVER) {
        const fallbackUsers = Array.isArray(task.activatedUserIds)
            ? task.activatedUserIds.filter(Boolean)
            : [task.activatorUserId || task.creatorUserId].filter(Boolean)
        if (fallbackUsers.length > 0) {
            groupedByRecurrence[task.recurrence] = [...new Set(fallbackUsers)]
        }
    }

    const recurrenceGroups = Object.entries(groupedByRecurrence)
    const externalIntegration =
        task?.taskMetadata?.externalIntegration && typeof task.taskMetadata.externalIntegration === 'object'
            ? task.taskMetadata.externalIntegration
            : {}
    const discoveredToolsCount = Array.isArray(externalIntegration.tools) ? externalIntegration.tools.length : 0
    const discoveryError =
        typeof externalIntegration.lastDiscoveryError === 'string' ? externalIntegration.lastDiscoveryError : ''
    const showIframeDiscoveryStatus = type === TASK_TYPE_IFRAME && (discoveredToolsCount > 0 || !!discoveryError)
    const iframeDiscoveryStatusText =
        discoveredToolsCount > 0
            ? translate('External tools discovered count', { count: discoveredToolsCount })
            : translate('External tool discovery failed')
    let templateSyncText = ''
    if (task.copiedFromTemplateTaskId) {
        if (
            task.templateSyncStatus === 'template_deleted_local_changes_preserved' ||
            task.templateSyncStatus === 'template_missing_local_preserved'
        ) {
            templateSyncText = translate('Template task deleted • local changes preserved')
        } else if (task.templateSyncStatus === 'needs_review') {
            templateSyncText = translate('Template changed • local changes preserved')
        } else {
            templateSyncText = translate('Synced from template')
            if (task.copiedFromTemplateTaskDate) {
                templateSyncText += ' • ' + new Date(task.copiedFromTemplateTaskDate).toLocaleString()
            }
        }
    }

    // Get icon based on task type
    const getIconForTaskType = () => {
        switch (type) {
            case TASK_TYPE_PROMPT:
                return 'message-square'
            case TASK_TYPE_EXTERNAL_LINK:
                return 'external-link'
            case TASK_TYPE_WEBHOOK:
                return 'link-2'
            case TASK_TYPE_IFRAME:
                return 'monitor'
            default:
                return 'cpu' // fallback
        }
    }

    return (
        <AddPreConfigTaskWrapper
            disabled={disabled}
            projectId={projectId}
            assistantId={assistantId}
            task={task}
            adding={false}
        >
            <View style={rowStyle}>
                <Icon name={getIconForTaskType()} size={24} color={colors.Text03} style={localStyles.leadingIcon} />
                <View style={localStyles.textArea}>
                    <Text style={localStyles.taskNameText} numberOfLines={1}>
                        {name}
                    </Text>
                    {showIframeDiscoveryStatus && (
                        <Text
                            style={[
                                localStyles.discoveryStatusText,
                                discoveredToolsCount > 0 ? localStyles.discoverySuccess : localStyles.discoveryError,
                            ]}
                            numberOfLines={1}
                        >
                            {iframeDiscoveryStatusText}
                        </Text>
                    )}
                    {!!templateSyncText && (
                        <Text style={localStyles.templateSyncText} numberOfLines={1}>
                            {templateSyncText}
                        </Text>
                    )}
                </View>
                {recurrenceGroups.length > 0 && (
                    <View style={localStyles.tagsArea}>
                        {recurrenceGroups.map(([recurrenceValue, userIds]) => {
                            const recurrenceData = getRecurrenceInfo(recurrenceValue)
                            return (
                                <View key={recurrenceValue} style={localStyles.recurrenceTag}>
                                    <Icon
                                        name={'rotate-cw'}
                                        size={12}
                                        color={colors.Text03}
                                        style={localStyles.tagIcon}
                                    />
                                    <Text style={localStyles.recurrenceText}>
                                        {translate(
                                            recurrenceData.short || recurrenceData.large,
                                            recurrenceData.interpolations
                                        )}
                                    </Text>
                                    <View style={localStyles.activatorsContainer}>
                                        {userIds.slice(0, 3).map((userId, index) => {
                                            const user = TasksHelper.getPeopleById(userId, projectId)
                                            return (
                                                <View
                                                    key={userId}
                                                    style={[
                                                        localStyles.avatarWrapper,
                                                        index > 0 && localStyles.avatarOverlap,
                                                    ]}
                                                >
                                                    <Avatar
                                                        avatarId={userId}
                                                        reviewerPhotoURL={user?.photoURL}
                                                        size={12}
                                                        borderSize={1}
                                                    />
                                                </View>
                                            )
                                        })}
                                        {userIds.length > 3 && (
                                            <Text style={localStyles.moreText}>+{userIds.length - 3}</Text>
                                        )}
                                    </View>
                                </View>
                            )
                        })}
                    </View>
                )}
                <Icon name="edit" size={20} color={colors.Text03} style={localStyles.trailingEditIcon} />
            </View>
        </AddPreConfigTaskWrapper>
    )
}

const localStyles = StyleSheet.create({
    fullRowClickable: {
        flexDirection: 'row',
        minHeight: 56,
        paddingLeft: 8,
        paddingRight: 16, // To ensure space for the trailing edit icon within clickable area
        paddingVertical: 8,
        alignItems: 'center',
        width: '100%',
    },
    leadingIcon: {
        marginRight: 8,
    },
    textArea: {
        flex: 1,
        marginRight: 8,
    },
    taskNameText: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    discoveryStatusText: {
        ...styles.caption2,
        marginTop: 2,
    },
    discoverySuccess: {
        color: colors.Green300,
    },
    discoveryError: {
        color: colors.Yellow300,
    },
    templateSyncText: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    tagsArea: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    recurrenceTag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        paddingLeft: 4,
        paddingRight: 6,
        height: 22,
        marginRight: 6,
    },
    tagIcon: {
        marginRight: 3,
    },
    recurrenceText: {
        ...styles.caption2,
        color: colors.Text03,
        marginRight: 4,
    },
    activatorsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarWrapper: {
        borderRadius: 99,
        overflow: 'hidden',
    },
    avatarOverlap: {
        marginLeft: -6,
    },
    moreText: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 4,
    },
    trailingEditIcon: {
        // No specific styles needed here as flex layout handles positioning
    },
})
