import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import DueDateButton from '../../UIControls/DueDateButton'
import { translate } from '../../../i18n/TranslationService'
import { setTaskDueDate, setTaskToBacklog } from '../../../utils/backends/Tasks/tasksFirestore'

export default function DueDate({ projectId, task, disabled }) {
    const saveTaskDueDate = (taskToUpdate, dateTimestamp, isObservedTabActive) => {
        // In this context, isObservedTabActive is always false as we are not in the "Observed" tab.
        setTaskDueDate(projectId, taskToUpdate.id, dateTimestamp, taskToUpdate, false, null)
    }

    const setTaskToBacklogInDetailedView = (taskToUpdate, isObservedTabActive) => {
        // In this context, isObservedTabActive is always false.
        setTaskToBacklog(projectId, taskToUpdate.id, taskToUpdate, false, null)
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="calendar" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Reminder')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <DueDateButton
                    projectId={projectId}
                    task={task}
                    disabled={disabled}
                    saveDueDateBeforeSaveTask={saveTaskDueDate}
                    setToBacklogBeforeSaveTask={setTaskToBacklogInDetailedView}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
