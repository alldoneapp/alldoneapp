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
} from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { RECURRENCE_MAP, RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'
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

    // Get icon based on task type
    const getIconForTaskType = () => {
        switch (type) {
            case TASK_TYPE_PROMPT:
                return 'message-square'
            case TASK_TYPE_EXTERNAL_LINK:
                return 'external-link'
            case TASK_TYPE_WEBHOOK:
                return 'link-2'
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
                <Text style={localStyles.taskNameText} numberOfLines={1}>
                    {name}
                </Text>
                {recurrenceGroups.length > 0 && (
                    <View style={localStyles.tagsArea}>
                        {recurrenceGroups.map(([recurrenceValue, userIds]) => {
                            const recurrenceData = RECURRENCE_MAP[recurrenceValue] || RECURRENCE_MAP[RECURRENCE_NEVER]
                            return (
                                <View key={recurrenceValue} style={localStyles.recurrenceTag}>
                                    <Icon
                                        name={'rotate-cw'}
                                        size={12}
                                        color={colors.Text03}
                                        style={localStyles.tagIcon}
                                    />
                                    <Text style={localStyles.recurrenceText}>
                                        {translate(recurrenceData.short || recurrenceData.large)}
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
