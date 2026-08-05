import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'
import { DragDropContext } from 'react-beautiful-dnd'

import styles, { colors } from '../../../styles/global'
import {
    watchAssistantTasks,
    updateAssistantTasksOrder,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import PreConfigTaskItem from './PreConfigTaskItem'
import DroppablePreConfigTaskList from './DroppablePreConfigTaskList'
import { RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PreConfigTaskList({ disabled, projectId, assistantId, isOrganizeMode }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [tasks, setTasks] = useState([])

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantTasks(projectId, assistantId, watcherKey, setTasks)
        return () => {
            unwatch(watcherKey)
        }
    }, [])

    // Handle drag end - reorder tasks
    const onDragEnd = result => {
        try {
            const { destination, source } = result

            // If dropped outside the list or no movement
            if (!destination || destination.index === source.index) {
                return
            }

            // Create new task order
            const newTasks = Array.from(tasks)
            const [removed] = newTasks.splice(source.index, 1)
            newTasks.splice(destination.index, 0, removed)

            // Update state immediately for better UX
            setTasks(newTasks)

            // Delay Firestore update to prevent focus issues with NameArea
            setTimeout(() => {
                // Update in firestore
                updateAssistantTasksOrder(projectId, assistantId, newTasks)
            }, 100)
        } catch (error) {
            console.error('Error during drag end:', error)
        }
    }

    const isRecurringTask = task => {
        const recurrenceByUser = task?.recurrenceByUser || {}
        const hasRecurringUser = Object.values(recurrenceByUser).some(
            recurrence => recurrence && recurrence !== RECURRENCE_NEVER
        )

        return hasRecurringUser || (!!task?.recurrence && task.recurrence !== RECURRENCE_NEVER)
    }

    const oneTimeTasks = tasks.filter(task => !isRecurringTask(task))
    const recurringTasks = tasks.filter(task => isRecurringTask(task))

    return (
        <View style={{ marginRight: smallScreen ? 0 : 72, width: '100%' }}>
            {isOrganizeMode ? (
                <DragDropContext onDragEnd={onDragEnd}>
                    <DroppablePreConfigTaskList
                        projectId={projectId}
                        assistantId={assistantId}
                        tasks={tasks}
                        disabled={disabled}
                    />
                </DragDropContext>
            ) : (
                <>
                    {oneTimeTasks.length > 0 && (
                        <View style={localStyles.section}>
                            <Text style={localStyles.sectionTitle}>{translate('One-time tasks')}</Text>
                            {oneTimeTasks.map(task => (
                                <PreConfigTaskItem
                                    disabled={disabled}
                                    key={task.id}
                                    projectId={projectId}
                                    task={task}
                                    assistantId={assistantId}
                                />
                            ))}
                        </View>
                    )}
                    {recurringTasks.length > 0 && (
                        <View style={localStyles.section}>
                            <Text style={localStyles.sectionTitle}>{translate('Recurring tasks')}</Text>
                            {recurringTasks.map(task => (
                                <PreConfigTaskItem
                                    disabled={disabled}
                                    key={task.id}
                                    projectId={projectId}
                                    task={task}
                                    assistantId={assistantId}
                                />
                            ))}
                        </View>
                    )}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 12,
    },
    sectionTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
        marginTop: 8,
        marginBottom: 4,
    },
})
