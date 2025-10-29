import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'
import { orderBy } from 'lodash'
import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import { CALENDAR_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import TasksList from './TasksList'
import ParentGoalSection from './ParentGoalSection'
import { sortBy } from 'lodash'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import GooleApi from '../../../apis/google/GooleApi'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import { useSelector } from 'react-redux'
import GeneralTasksHeader from './GeneralTasksHeader'
// Removed global single-project lookup; use the current project instead
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

export default function CalendarSection({ projectId, calendarEvents, dateIndex, isActiveOrganizeMode, instanceKey }) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [showReload, setShowReload] = useState(false)
    const firstLoginDateInDay = useSelector(state => state.loggedUser.firstLoginDateInDay)

    useEffect(() => {
        GooleApi.onLoad(() => {
            setShowReload(GooleApi.checkAccessGranted())
        })
    }, [])

    const openLink = () => {
        return window.open(
            'https://calendar.google.com/calendar/u/?' + `authuser=${calendarEvents[0][1][0].calendarData.email}`,
            '_blank'
        )
    }

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        currentUserId,
        calendarEvents
    )

    if (!goalsPositionId) return null

    const sortedCalendarTasks = [...calendarEvents]
    sortedCalendarTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader = sortedCalendarTasks.length > 0 && sortedCalendarTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    const sortCalendarTaskListChronologically = (tasks, firstLoginDate, endTimeForAllDay) => {
        if (!tasks || tasks.length === 0) return []
        return orderBy(
            tasks,
            [
                task => {
                    if (!task.calendarData?.start) return Number.MAX_SAFE_INTEGER
                    return task.calendarData.start.dateTime
                        ? moment(task.calendarData.start.dateTime).valueOf()
                        : firstLoginDate
                },
                task => {
                    if (!task.calendarData?.end) return Number.MAX_SAFE_INTEGER
                    return task.calendarData.end.dateTime
                        ? moment(task.calendarData.end.dateTime).valueOf()
                        : endTimeForAllDay
                },
                task => task.id,
            ],
            ['asc', 'asc', 'asc']
        )
    }

    const ALL_DAY_EVENT_DURATION_IN_HOURS = 8
    const endTimeForAllDayCalendarTasks = moment(firstLoginDateInDay)
        .add(ALL_DAY_EVENT_DURATION_IN_HOURS, 'hours')
        .valueOf()

    // Get the calendar-connected project ID from the calendar task data
    const getCalendarConnectedProjectId = () => {
        const firstTask = calendarEvents?.[0]?.[1]?.[0]
        if (!firstTask?.calendarData) {
            console.log('[CalendarSection] No calendar task data, using current projectId:', projectId)
            return projectId
        }

        console.log('[CalendarSection] First calendar task data:', firstTask.calendarData)

        // Use pinnedToProjectId if explicitly pinned
        if (firstTask.calendarData.pinnedToProjectId) {
            console.log('[CalendarSection] Using pinnedToProjectId:', firstTask.calendarData.pinnedToProjectId)
            return firstTask.calendarData.pinnedToProjectId
        }

        // Use originalProjectId if available (the project where calendar was first connected)
        if (firstTask.calendarData.originalProjectId) {
            console.log('[CalendarSection] Using originalProjectId:', firstTask.calendarData.originalProjectId)
            return firstTask.calendarData.originalProjectId
        }

        // Fallback: find which project is connected to this calendar email
        const calendarEmail = firstTask.calendarData.email
        console.log('[CalendarSection] Looking for project with calendar email:', calendarEmail)
        if (apisConnected && calendarEmail) {
            for (const [projId, apis] of Object.entries(apisConnected)) {
                if (apis.calendar && apis.calendarEmail === calendarEmail) {
                    console.log('[CalendarSection] Found matching project:', projId)
                    return projId
                }
            }
        }

        console.log('[CalendarSection] No matching project found, using current projectId:', projectId)
        return projectId
    }

    const calendarConnectedProjectId = getCalendarConnectedProjectId()
    console.log(
        '[CalendarSection] Final calendarConnectedProjectId:',
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
                    {showReload && calendarEvents && calendarEvents.length > 0 && (
                        <ReloadCalendar projectId={calendarConnectedProjectId} Promise={checkIfCalendarConnected} />
                    )}
                </View>
            </View>

            {sortedCalendarTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const chronoSortedTaskList = sortCalendarTaskListChronologically(
                    taskList,
                    firstLoginDateInDay,
                    endTimeForAllDayCalendarTasks
                )
                const isLastIndex = sortedCalendarTasks.length - 1 === index
                const goalIndex = calendarEvents.findIndex(data => data[0] === goalId)
                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <View key={goalId}>
                        {showGneralTasksHeader && (
                            <SwipeableGeneralTasksHeader
                                projectId={projectId}
                                taskList={taskList}
                                dateIndex={dateIndex}
                                instanceKey={instanceKey}
                            />
                        )}
                        <TasksList
                            projectId={projectId}
                            dateIndex={dateIndex}
                            subtaskByTask={[]}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={chronoSortedTaskList}
                            taskListIndex={CALENDAR_TASK_INDEX}
                            goalIndex={goalIndex}
                            instanceKey={instanceKey}
                        />
                    </View>
                ) : (
                    <ParentGoalSection
                        key={goalId}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        goalId={goalId}
                        subtaskByTask={[]}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={chronoSortedTaskList}
                        taskListIndex={CALENDAR_TASK_INDEX}
                        containerStyle={isLastIndex ? null : { marginBottom: 16 }}
                        goalIndex={goalIndex}
                        instanceKey={instanceKey}
                    />
                )
            })}
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
        marginTop: 32,
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
