import React, { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MyDayOpenTasks from './MyDayTasks/MyDayOpenTasks/MyDayOpenTasks'
import MyDayWorkflowTasks from './MyDayTasks/MyDayWorkflowTasks/MyDayWorkflowTasks'
import MyDayDoneTasks from './MyDayTasks/MyDayDoneTasks/MyDayDoneTasks'
import { checkIfCalendarConnected, checkIfGmailIsConnected } from '../../utils/backends/firestore'
import store from '../../redux/store'

export default function MyDayView() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    const inOpenSection = taskViewToggleSection === 'Open'
    const inWorkflowSection = taskViewToggleSection === 'Workflow'
    const inDoneSection = taskViewToggleSection === 'Done'

    // Auto-sync calendar and gmail on page load
    // Now safe with server-side sync + cooldown cache
    useEffect(() => {
        const { apisConnected } = store.getState().loggedUser
        if (apisConnected) {
            console.log('[MyDayView] 🔄 Checking syncs for all connected projects...')
            Object.entries(apisConnected).forEach(([pid, flags]) => {
                if (flags?.calendar) {
                    console.log('[MyDayView] 📅 Checking calendar sync for project:', pid)
                    checkIfCalendarConnected(pid)
                }
                if (flags?.gmail) {
                    console.log('[MyDayView] 📧 Checking gmail sync for project:', pid)
                    checkIfGmailIsConnected(pid)
                }
            })
        }
    }, [])

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
