import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import { CALENDAR_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import GoalTasksList from './GoalTasksList'

export default function GoalOpenTasksCalendarSection({ projectId, calendarTasks, dateIndex, isActiveOrganizeMode }) {
    const openLink = () => {
        return window.open(
            'https://calendar.google.com/calendar/u/?' + `authuser=${calendarTasks[0].calendarData.email}`,
            '_blank'
        )
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleCalendar />
                        <Text style={localStyles.title}>Google Calendar</Text>
                    </TouchableOpacity>
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
