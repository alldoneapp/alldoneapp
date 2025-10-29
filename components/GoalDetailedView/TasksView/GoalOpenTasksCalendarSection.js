import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import { CALENDAR_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import GoalTasksList from './GoalTasksList'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import GooleApi from '../../../apis/google/GooleApi'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'

export default function GoalOpenTasksCalendarSection({ projectId, calendarTasks, dateIndex, isActiveOrganizeMode }) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)
    const [showReload, setShowReload] = useState(false)

    useEffect(() => {
        GooleApi.onLoad(() => {
            setShowReload(GooleApi.checkAccessGranted())
        })
    }, [])

    const openLink = () => {
        return window.open(
            'https://calendar.google.com/calendar/u/?' + `authuser=${calendarTasks[0].calendarData.email}`,
            '_blank'
        )
    }

    // Get the calendar-connected project ID from the calendar task data
    const getCalendarConnectedProjectId = () => {
        const firstTask = calendarTasks?.[0]
        if (!firstTask?.calendarData) {
            console.log('[GoalCalendarSection] No calendar task data, using current projectId:', projectId)
            return projectId
        }

        console.log('[GoalCalendarSection] First calendar task data:', firstTask.calendarData)

        // Use pinnedToProjectId if explicitly pinned
        if (firstTask.calendarData.pinnedToProjectId) {
            console.log('[GoalCalendarSection] Using pinnedToProjectId:', firstTask.calendarData.pinnedToProjectId)
            return firstTask.calendarData.pinnedToProjectId
        }

        // Use originalProjectId if available (the project where calendar was first connected)
        if (firstTask.calendarData.originalProjectId) {
            console.log('[GoalCalendarSection] Using originalProjectId:', firstTask.calendarData.originalProjectId)
            return firstTask.calendarData.originalProjectId
        }

        // Fallback: find which project is connected to this calendar email
        const calendarEmail = firstTask.calendarData.email
        console.log('[GoalCalendarSection] Looking for project with calendar email:', calendarEmail)
        if (apisConnected && calendarEmail) {
            for (const [projId, apis] of Object.entries(apisConnected)) {
                if (apis.calendar && apis.calendarEmail === calendarEmail) {
                    console.log('[GoalCalendarSection] Found matching project:', projId)
                    return projId
                }
            }
        }

        console.log('[GoalCalendarSection] No matching project found, using current projectId:', projectId)
        return projectId
    }

    const calendarConnectedProjectId = getCalendarConnectedProjectId()
    console.log(
        '[GoalCalendarSection] Final calendarConnectedProjectId:',
        calendarConnectedProjectId,
        'Current projectId:',
        projectId
    )

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleCalendar />
                        <Text style={localStyles.title}>Google Calendar</Text>
                    </TouchableOpacity>
                    {showReload && calendarTasks && calendarTasks.length > 0 && (
                        <ReloadCalendar projectId={calendarConnectedProjectId} Promise={checkIfCalendarConnected} />
                    )}
                </View>
            </View>

            <GoalTasksList
                projectId={projectId}
                taskList={calendarTasks}
                dateIndex={dateIndex}
                taskListIndex={CALENDAR_TASK_INDEX}
                isActiveOrganizeMode={isActiveOrganizeMode}
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
