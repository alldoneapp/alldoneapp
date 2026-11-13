import React, { useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import { TaskHierarchyGroup } from '../TaskHierarchy'

import styles, { colors } from '../../styles/global'
import GoogleCalendar from '../../../assets/svg/GoogleCalendar'
import {
    CALENDAR_TASK_INDEX,
    DATE_TASK_INDEX,
    NOT_PARENT_GOAL_INDEX,
    sortGoalTasksGorups,
} from '../../../utils/backends/openTasks'
import TasksList from './TasksList'
import ParentGoalSection from './ParentGoalSection'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import { buildChronologicalCalendarRuns } from './calendarSectionGrouping'
import { getTaskGroupSpacingStyle } from './taskGroupSpacing'
import CalendarSectionMoreButton from '../../UIComponents/FloatModals/PrepareMeetings/CalendarSectionMoreButton'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { useIsUserEditing } from '../../../utils/editingGuard'
import { createSectionRenderBudget } from './sectionRenderBudget'
import useCollapsibleTaskSection from './useCollapsibleTaskSection'
import {
    CALENDAR_SECTION_KEY,
    allocateSectionTaskBudget,
    countSectionTasks,
    shouldOfferSectionToggle,
} from './collapsibleTaskSection'
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
 *
 * AT-3027 - collapsed to the first `COLLAPSED_SECTION_TASK_LIMIT` meetings of that chronological
 * list (past ones included), with its own chevron. See collapsibleTaskSection.js.
 */
export default function CalendarSection({
    projectId,
    projectIndex,
    calendarEvents,
    dateIndex,
    isActiveOrganizeMode,
    instanceKey,
}) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)
    const displayedProjectSections = useSelector(state => state.filteredOpenTasksStore?.[instanceKey])
    const dateKey = useSelector(state => state.filteredOpenTasksStore?.[instanceKey]?.[dateIndex]?.[DATE_TASK_INDEX])
    const isUserEditing = useIsUserEditing()
    const renderedAmountsRef = useRef({})
    const { expanded, expand, contract } = useCollapsibleTaskSection({
        projectId,
        projectIndex,
        dateKey,
        sectionKey: CALENDAR_SECTION_KEY,
    })

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

    // The cut follows the chronological runs, so the visible meetings are the first ones of the day.
    const runTaskLists = calendarRuns.map(run => run.taskList)
    const showToggle = shouldOfferSectionToggle(countSectionTasks(runTaskLists), isActiveOrganizeMode)
    const collapsed = showToggle && !expanded
    const amounts = allocateSectionTaskBudget(runTaskLists, collapsed)

    // Hold mounted runs at their last idle size while the user edits (AT-2203 rule), so a meeting
    // synced in ahead of the one being edited cannot unmount its editor.
    const sectionBudget = createSectionRenderBudget(isUserEditing, renderedAmountsRef)
    const visibleCalendarRuns = []
    calendarRuns.forEach((run, index) => {
        const amount = sectionBudget.resolve(run.key, amounts[index] === null ? run.taskList.length : amounts[index])
        if (sectionBudget.shouldSkip(run.key, amount, collapsed)) return
        sectionBudget.remember(run.key, amount)
        visibleCalendarRuns.push({ ...run, amountToRender: collapsed ? amount : undefined })
    })

    const allCalendarTasks = calendarEvents.flatMap(goalTasksData => goalTasksData[1])
    const displayedProjectCalendarTasks = displayedProjectSections?.flatMap(day =>
        (day[CALENDAR_TASK_INDEX] || []).flatMap(([, tasks]) => tasks)
    )
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
                    <CalendarSectionMoreButton
                        projectId={projectId}
                        tasks={displayedProjectCalendarTasks || allCalendarTasks}
                    />
                    {connectedProjectIds.length > 0 && (
                        <ReloadCalendar projectId={connectedProjectIds} Promise={syncAllCalendars} />
                    )}
                </View>
            </View>

            {visibleCalendarRuns.map(({ goalId, taskList, goalIndex, occurrence, key, amountToRender }, index) => {
                // Same gap below every group as the main list (MainSection), general and goal alike.
                const spacingStyle = getTaskGroupSpacingStyle(visibleCalendarRuns.length - 1 === index)

                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <TaskHierarchyGroup key={key} style={spacingStyle}>
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
                            amountToRender={amountToRender}
                            instanceKey={instanceKey}
                        />
                    </TaskHierarchyGroup>
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
                        containerStyle={spacingStyle}
                        goalIndex={goalIndex}
                        amountToRender={amountToRender}
                        instanceKey={instanceKey}
                    />
                )
            })}

            {showToggle && (
                <ShowMoreButton expanded={expanded} contract={contract} expand={expand} style={{ marginBottom: 0 }} />
            )}
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
