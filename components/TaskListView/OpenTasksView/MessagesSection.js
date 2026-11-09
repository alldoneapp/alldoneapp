import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import { TaskHierarchyGroup } from '../TaskHierarchy'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { MESSAGE_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import { translate } from '../../../i18n/TranslationService'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

// A stable empty list, so a day without the bucket does not re-render on every store change.
const NO_MESSAGE_TASKS = []

/**
 * The "Messages" section of one day on the open-tasks board (UNIFIED_INBOX_PLAN.md): conversations
 * that need the user's reply, one task each. Grouped by goal like the main list; inside a group the
 * newest message comes first (sorted in openTasks.js, never by priority).
 */
export default function MessagesSection({ projectId, dateIndex, instanceKey, isActiveOrganizeMode }) {
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const messageTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][MESSAGE_TASK_INDEX] || NO_MESSAGE_TASKS
    )
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)

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

            {sortedMessageTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedMessageTasks.length - 1 === index
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
                            containerStyle={sortedMessageTasks.length > 1 ? { marginBottom: 16 } : null}
                            goalIndex={goalIndex}
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
})
