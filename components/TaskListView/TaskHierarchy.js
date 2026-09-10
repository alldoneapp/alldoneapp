import React, { createContext, useContext } from 'react'
import { StyleSheet, View } from 'react-native'

// Presentation scope only. Shared task/goal rows keep their existing behavior and
// appearance outside the All Projects open-task board.
export const TaskHierarchyContext = createContext(false)
export const TaskHierarchyBackgroundContext = createContext('#FFFFFF')
export const useTaskHierarchyBackground = () => useContext(TaskHierarchyBackgroundContext)
export const useTaskHierarchy = () => useContext(TaskHierarchyContext)

export function TaskHierarchyGroup({ children, style }) {
    const enabled = useTaskHierarchy()
    return (
        <View style={[style, enabled && taskHierarchyStyles.group, enabled && taskHierarchyStyles.goalGroup]}>
            {children}
            <TaskHierarchyGoalOutline />
        </View>
    )
}

// Draw the edge above row backgrounds without clipping swipe actions or popovers.
export function TaskHierarchyGoalOutline() {
    const enabled = useTaskHierarchy()
    return enabled ? <View pointerEvents="none" style={taskHierarchyStyles.goalOutline} /> : null
}

export const taskHierarchyStyles = StyleSheet.create({
    project: {
        borderRadius: 12,
    },
    projectBody: {
        paddingHorizontal: 8,
        paddingBottom: 12,
    },
    group: {
        backgroundColor: '#F6F7F9',
        borderRadius: 8,
        paddingHorizontal: 0,
        paddingBottom: 8,
        paddingTop: 4,
    },
    goalGroup: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#DDE4EB',
        paddingTop: 0,
        paddingBottom: 0,
    },
    goalRowOutline: {
        position: 'absolute',
        top: -1,
        bottom: 0,
        left: -1,
        right: -1,
        borderWidth: 2,
        borderColor: '#DDE4EB',
        borderRadius: 8,
        zIndex: 1,
    },
    goalOutline: {
        position: 'absolute',
        top: -1,
        bottom: -1,
        left: -1,
        right: -1,
        borderWidth: 1,
        borderColor: '#DDE4EB',
        borderRadius: 8,
        zIndex: 1,
    },
    taskFamily: {
        backgroundColor: 'transparent',
        borderRadius: 6,
        marginVertical: 4,
        paddingBottom: 6,
    },
    subtasks: {
        marginLeft: 0,
    },
})
