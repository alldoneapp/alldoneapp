import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MyDayOpenTasks from './MyDayTasks/MyDayOpenTasks/MyDayOpenTasks'
import MyDayWorkflowTasks from './MyDayTasks/MyDayWorkflowTasks/MyDayWorkflowTasks'
import MyDayDoneTasks from './MyDayTasks/MyDayDoneTasks/MyDayDoneTasks'

export default function MyDayView() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    const inOpenSection = taskViewToggleSection === 'Open'
    const inWorkflowSection = taskViewToggleSection === 'Workflow'
    const inDoneSection = taskViewToggleSection === 'Done'

    // Removed auto-sync on page load - users should manually trigger sync via the sync button
    // Auto-syncing was causing race conditions and duplicate task creation/deletion

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inOpenSection && <MyDayOpenTasks />}
            {inWorkflowSection && <MyDayWorkflowTasks />}
            {inDoneSection && <MyDayDoneTasks />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
