import React, { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MyDayOpenTasks from './MyDayTasks/MyDayOpenTasks/MyDayOpenTasks'
import MyDayWorkflowTasks from './MyDayTasks/MyDayWorkflowTasks/MyDayWorkflowTasks'
import MyDayDoneTasks from './MyDayTasks/MyDayDoneTasks/MyDayDoneTasks'
import gooleApi from '../../apis/google/GooleApi'
import { checkIfCalendarConnected, checkIfGmailIsConnected } from '../../utils/backends/firestore'
import store from '../../redux/store'

export default function MyDayView() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    const inOpenSection = taskViewToggleSection === 'Open'
    const inWorkflowSection = taskViewToggleSection === 'Workflow'
    const inDoneSection = taskViewToggleSection === 'Done'

    useEffect(() => {
        gooleApi.onLoad(() => {
            const { apisConnected } = store.getState().loggedUser
            if (apisConnected) {
                Object.entries(apisConnected).forEach(([pid, flags]) => {
                    if (flags?.calendar) checkIfCalendarConnected(pid)
                    if (flags?.gmail) checkIfGmailIsConnected(pid)
                })
            }
        })
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
