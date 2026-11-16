import React, { useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import { TaskHierarchyGroup } from '../TaskHierarchy'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import {
    DATE_TASK_INDEX,
    MESSAGE_TASK_INDEX,
    NOT_PARENT_GOAL_INDEX,
    sortGoalTasksGorups,
} from '../../../utils/backends/openTasks'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import { translate } from '../../../i18n/TranslationService'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { useIsUserEditing } from '../../../utils/editingGuard'
import { createSectionRenderBudget } from './sectionRenderBudget'
import useCollapsibleTaskSection from './useCollapsibleTaskSection'
import {
    MESSAGES_SECTION_KEY,
    allocateSectionTaskBudget,
    countSectionTasks,
    shouldOfferSectionToggle,
} from './collapsibleTaskSection'

// A stable empty list, so a day without the bucket does not re-render on every store change.
const NO_MESSAGE_TASKS = []

/**
 * The "Messages" section of one day on the open-tasks board (UNIFIED_INBOX_PLAN.md): conversations
 * that need the user's reply, one task each. Grouped by goal like the main list; inside a group the
 * newest message comes first (sorted in openTasks.js, never by priority).
 *
 * AT-3027 - collapsed to the first `COLLAPSED_SECTION_TASK_LIMIT` messages, with its own chevron
 * (see collapsibleTaskSection.js).
 */
export default function MessagesSection({ projectId, projectIndex, dateIndex, instanceKey, isActiveOrganizeMode }) {
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const messageTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][MESSAGE_TASK_INDEX] || NO_MESSAGE_TASKS
    )
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)
    const dateKey = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const isUserEditing = useIsUserEditing()
    const renderedAmountsRef = useRef({})
    const { expanded, expand, contract } = useCollapsibleTaskSection({
        projectId,
        projectIndex,
        dateKey,
        sectionKey: MESSAGES_SECTION_KEY,
    })

    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        currentUserId,
        messageTasks
    )

    if (!goalsPositionId) return null

    const sortedMessageTasks = [...messageTasks]
    sortedMessageTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGeneralTasksHeader = sortedMessageTasks.length > 0 && sortedMessageTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    const taskLists = sortedMessageTasks.map(goalTasksData => goalTasksData[1])
    const showToggle = shouldOfferSectionToggle(countSectionTasks(taskLists), isActiveOrganizeMode)
    const collapsed = showToggle && !expanded
    const amounts = allocateSectionTaskBudget(taskLists, collapsed)

    // A message arriving while the user edits another one must not push the edited row out of the
    // first three and unmount its editor: hold every group at its last idle size (AT-2203 rule).
    const sectionBudget = createSectionRenderBudget(isUserEditing, renderedAmountsRef)
    const visibleMessageTasks = []
    sortedMessageTasks.forEach((goalTasksData, index) => {
        const goalId = goalTasksData[0]
        const taskList = goalTasksData[1]
        const amount = sectionBudget.resolve(goalId, amounts[index] === null ? taskList.length : amounts[index])
        if (sectionBudget.shouldSkip(goalId, amount, collapsed)) return
        sectionBudget.remember(goalId, amount)
        visibleMessageTasks.push({ goalId, taskList, amountToRender: collapsed ? amount : undefined })
    })

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <Icon name="message-circle" color={colors.Text03} size={20} />
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.caption1, { color: colors.Text03 }]}>{translate('Messages')}</Text>
                    </View>
                </View>
            </View>

            {visibleMessageTasks.map(({ goalId, taskList, amountToRender }, index) => {
                const isLastIndex = visibleMessageTasks.length - 1 === index
                const groupSpacingStyle = isLastIndex ? null : { marginBottom: 16 }
                const goalIndex = messageTasks.findIndex(data => data[0] === goalId)
                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <TaskHierarchyGroup key={goalId}>
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
                            subtaskByTask={subtaskByTask}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={taskList}
                            taskListIndex={MESSAGE_TASK_INDEX}
                            containerStyle={groupSpacingStyle}
                            goalIndex={goalIndex}
                            amountToRender={amountToRender}
                            instanceKey={instanceKey}
                        />
                    </TaskHierarchyGroup>
                ) : (
                    <ParentGoalSection
                        key={goalId}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        goalId={goalId}
                        subtaskByTask={subtaskByTask}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={taskList}
                        taskListIndex={MESSAGE_TASK_INDEX}
                        containerStyle={groupSpacingStyle}
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
})
