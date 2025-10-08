import React from 'react'
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import SharedHelper from '../../../../utils/SharedHelper'
import {
    TASK_TYPE_PROMPT,
    TASK_TYPE_EXTERNAL_LINK,
    TASK_TYPE_WEBHOOK,
} from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import TaskRecurrence from '../../../Tags/TaskRecurrence'
import { RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'

export default function PreConfigTaskButton({ task, onPress, projectId }) {
    const loggedUser = useSelector(state => state.loggedUser)

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const { name, type, recurrence } = task

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
        <TouchableOpacity style={localStyles.container} onPress={onPress} disabled={!accessGranted}>
            <Icon name={getIconForTaskType()} size={24} color={colors.Text03} />
            <Text style={localStyles.name}>{name}</Text>
            {recurrence && recurrence !== RECURRENCE_NEVER && (
                <View style={localStyles.tagContainer}>
                    <TaskRecurrence task={task} projectId={projectId} disabled={true} />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 19,
        minHeight: 48,
        backgroundColor: '#rgba(238, 238, 238, 0.24)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(238, 238, 238, 1)',
        shadowColor: 'rgba(0, 0, 0, 0.25)',
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 4,
        flexDirection: 'row',
        paddingHorizontal: 14,
        paddingVertical: 4,
        alignItems: 'center',
    },
    name: {
        ...styles.body1,
        color: '#000000',
        marginLeft: 28,
        flex: 1,
    },
    tagContainer: {
        marginLeft: 8,
    },
})
