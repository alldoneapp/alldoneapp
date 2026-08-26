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
import { buildChronologicalCalendarRuns } from './calendarSectionGrouping'
import {
    getCalendarConnectedProjectIds,
    getCalendarProviderUrl,
    getCalendarSectionTitle,
} from './calendarSectionHelper'

/**
 * AT-2377 - the dedicated "Calendar" section of one day on the open-tasks board.
 *
 * Meetings are shown here instead of inside the priority-sorted main list, ordered by event start
 * rather than by goal position, priority or `sortIndex`: a meeting happens when it happens, so the
 * order the user cares about is the clock.
 *
 * AT-2436 - the clock wins over the grouping, not the other way round. The whole day is sorted
 * chronologically first and then cut into runs of consecutive meetings that share a goal
 * (`buildChronologicalCalendarRuns`), so a goal card is a heading INSIDE the chronological list and
 * the "General tasks" header resumes after it. Rendering the store's goal buckets as contiguous
 * blocks - what this section did before - meant one meeting carrying a goal dragged the whole
 * bucket to its position and left its own start time out of order.
 *
 * The chronological order itself comes from `compareTasksByCalendarPlacement`, the AT-2351 rule,
 * rather than from a local sort: "(calendar day, all-day first, start time, arrival)". Reusing it
 * keeps this section, My Day and the focus-task pick from disagreeing about which meeting is next.
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

    const calendarRuns = buildChronologicalCalendarRuns(calendarEvents)

    // Same rule as the main list's `hasGoals` (MainSection): the "General tasks" header only means
    // something once a goal heading is on screen to tell it apart from. When it does, EVERY run
    // without a goal gets one - including the first - so the reading stays General -> goal -> General.
    const showGeneralTasksHeader = calendarRuns.some(run => run.goalId !== NOT_PARENT_GOAL_INDEX)

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

            {calendarRuns.map(({ goalId, taskList, goalIndex, occurrence, key }, index) => {
                const isLastIndex = calendarRuns.length - 1 === index

                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <View key={key}>
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
                        key={key}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        goalId={goalId}
                        subtaskByTask={[]}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={taskList}
                        taskListIndex={CALENDAR_TASK_INDEX}
                        // A goal split across two runs renders two cards, so their `refKey`s - built
                        // from `${goalId}${dateIndex}${taskListIndex}${nestedTaskListIndex}` - have to
                        // differ, or the two cards share one dismissible ref and open each other's
                        // edit popup. Only the second and later runs need it, so the single-run case
                        // (every goal, almost always) keeps the exact key it had before.
                        nestedTaskListIndex={occurrence > 0 ? occurrence : undefined}
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
