import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'
import { DragDropContext } from 'react-beautiful-dnd'

import {
    watchAssistantTasks,
    updateAssistantTasksOrder,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import PreConfigTaskItem from './PreConfigTaskItem'
import DroppablePreConfigTaskList from './DroppablePreConfigTaskList'

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
                tasks.map(task => (
                    <PreConfigTaskItem
                        disabled={disabled}
                        key={task.id}
                        projectId={projectId}
                        task={task}
                        assistantId={assistantId}
                    />
                ))
            )}
        </View>
    )
}
