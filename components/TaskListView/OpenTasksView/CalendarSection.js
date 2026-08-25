import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import { CALENDAR_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import TasksList from './TasksList'
import ParentGoalSection from './ParentGoalSection'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import { compareTasksByCalendarPlacement, orderCalendarTasksLast } from '../../../utils/CalendarTaskOrder'
import {
    getCalendarConnectedProjectIds,
    getCalendarProviderUrl,
    getCalendarSectionTitle,
} from './calendarSectionHelper'

/**
 * AT-2377 - the dedicated "Calendar" section of one day on the open-tasks board.
 *
 * Meetings are shown here instead of inside the priority-sorted main list. They are still grouped
 * by goal, but both the meetings inside a group and the groups themselves are ordered by event
 * start rather than by goal position, priority or `sortIndex`: a meeting happens when it happens,
 * so the order the user cares about is the clock.
 *
 * The chronological order comes from `orderCalendarTasksLast`, the AT-2351 rule, rather than from
 * a local sort. Applied to a list that is entirely calendar tasks it reduces to exactly
 * "(calendar day, all-day first, start time, arrival)", and reusing it keeps this section, My Day
 * and the focus-task pick from disagreeing about which meeting is next.
 */
export default function CalendarSection({ projectId, calendarEvents, dateIndex, isActiveOrganizeMode, instanceKey }) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        currentUserId,
        calendarEvents
    )

    if (!goalsPositionId) return null

    const sortedCalendarTasks = calendarEvents
        .map((goalTasksData, index) => ({
            goalId: goalTasksData[0],
            taskList: orderCalendarTasksLast(goalTasksData[1]),
            index,
        }))
        .sort((a, b) => {
            const firstTaskA = a.taskList[0]
            const firstTaskB = b.taskList[0]

            if (!firstTaskA || !firstTaskB) {
                if (!firstTaskA && !firstTaskB) return a.index - b.index
                return firstTaskA ? -1 : 1
            }

            return compareTasksByCalendarPlacement(firstTaskA, firstTaskB) || a.index - b.index
        })
        .map(({ goalId, taskList }) => [goalId, taskList])

    const showGeneralTasksHeader = sortedCalendarTasks.length > 0 && sortedCalendarTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    const allCalendarTasks = calendarEvents.flatMap(goalTasksData => goalTasksData[1])
    const firstCalendarData = allCalendarTasks[0]?.calendarData
    const connectedProjectIds = getCalendarConnectedProjectIds(allCalendarTasks, apisConnected, projectId)

    const openLink = () => window.open(getCalendarProviderUrl(firstCalendarData), '_blank')

    const syncAllCalendars = projectIds => Promise.all(projectIds.map(pid => checkIfCalendarConnected(pid)))

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleCalendar />
                        <Text style={localStyles.title}>{getCalendarSectionTitle(firstCalendarData)}</Text>
                    </TouchableOpacity>
                    {connectedProjectIds.length > 0 && (
                        <ReloadCalendar projectId={connectedProjectIds} Promise={syncAllCalendars} />
                    )}
                </View>
            </View>

            {sortedCalendarTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedCalendarTasks.length - 1 === index
                const goalIndex = calendarEvents.findIndex(data => data[0] === goalId)

                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <View key={goalId}>
                        {showGeneralTasksHeader && (
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
                            taskList={taskList}
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
                        taskList={taskList}
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
