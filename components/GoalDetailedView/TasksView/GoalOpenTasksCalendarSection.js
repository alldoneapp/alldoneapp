import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import { CALENDAR_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import GoalTasksList from './GoalTasksList'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import { orderCalendarTasksLast } from '../../../utils/CalendarTaskOrder'
import {
    getCalendarConnectedProjectIds,
    getCalendarProviderUrl,
    getCalendarSectionTitle,
} from '../../TaskListView/OpenTasksView/calendarSectionHelper'

/**
 * AT-2377 - the goal detailed view's own "Calendar" section, the counterpart of
 * `TaskListView/OpenTasksView/CalendarSection`. A goal only ever lists TODAY's events; that filter
 * lives in `openGoalTasks.processTasks`, not here.
 */
export default function GoalOpenTasksCalendarSection({ projectId, calendarTasks, dateIndex, isActiveOrganizeMode }) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)

    const firstCalendarData = calendarTasks[0]?.calendarData
    const connectedProjectIds = getCalendarConnectedProjectIds(calendarTasks, apisConnected, projectId)
    const syncProjectId = connectedProjectIds[0]

    const openLink = () => window.open(getCalendarProviderUrl(firstCalendarData), '_blank')

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleCalendar />
                        <Text style={localStyles.title}>{getCalendarSectionTitle(firstCalendarData)}</Text>
                    </TouchableOpacity>
                    {syncProjectId && <ReloadCalendar projectId={syncProjectId} Promise={checkIfCalendarConnected} />}
                </View>
            </View>

            <GoalTasksList
                projectId={projectId}
                dateIndex={dateIndex}
                isActiveOrganizeMode={isActiveOrganizeMode}
                taskList={orderCalendarTasksLast(calendarTasks)}
                taskListIndex={CALENDAR_TASK_INDEX}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    subContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        marginTop: 52,
        paddingBottom: 2,
        paddingLeft: 2,
    },
    centeredRow: {
        flex: 1,
        maxHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
