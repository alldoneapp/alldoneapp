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
import GoogleApi from '../../../apis/google/GoogleApi'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../apis/google/GoogleOAuthServerSide'
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
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendar)

    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                GoogleApi.onLoad(async () => {
                    const authStatus = await hasServerSideAuth()
                    if (authStatus.hasCredentials && isConnected) {
                        // Load the server-side token into GoogleApi so API calls work
                        await setServerTokenInGoogleApi(GoogleApi)
                        setShowReload(true)
                    } else {
                        setShowReload(false)
                    }
                })
            } catch (error) {
                console.error('[CalendarSection] Error checking server auth:', error)
                setShowReload(false)
            }
        }

        checkServerAuth()
    }, [isConnected, projectId])

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
    // For syncing, we need the project with calendar API connection, not where task currently lives
    const getCalendarConnectedProjectId = () => {
        const firstTask = calendarEvents?.[0]?.[1]?.[0]
        if (!firstTask?.calendarData) {
            if (__DEV__) console.log('[CalendarSection] No calendar task data, using current projectId:', projectId)
            return projectId
        }

        if (__DEV__) console.log('[CalendarSection] First calendar task data:', firstTask.calendarData)

        // Use originalProjectId if available (the project where calendar was first connected)
        // This is the project with the API connection, which we need for syncing
        if (firstTask.calendarData.originalProjectId) {
            if (__DEV__)
                console.log('[CalendarSection] Using originalProjectId:', firstTask.calendarData.originalProjectId)
            return firstTask.calendarData.originalProjectId
        }

        // Fallback: find which project is connected to this calendar email
        const calendarEmail = firstTask.calendarData.email
        if (__DEV__) console.log('[CalendarSection] Looking for project with calendar email:', calendarEmail)
        if (apisConnected && calendarEmail) {
            for (const [projId, apis] of Object.entries(apisConnected)) {
                if (apis.calendar && apis.calendarEmail === calendarEmail) {
                    if (__DEV__) console.log('[CalendarSection] Found matching project:', projId)
                    return projId
                }
            }
        }

        if (__DEV__) console.log('[CalendarSection] No matching project found, using current projectId:', projectId)
        return projectId
    }

    const calendarConnectedProjectId = getCalendarConnectedProjectId()
    if (__DEV__) {
        console.log(
            '[CalendarSection] Final calendarConnectedProjectId:',
            calendarConnectedProjectId,
            'Current projectId:',
            projectId
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
                    {showReload && isConnected && (
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
