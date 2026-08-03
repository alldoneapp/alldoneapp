import React from 'react'
import { useSelector } from 'react-redux'
import { Image, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import TasksHelper from '../Utils/TasksHelper'
import { SUGGESTED_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import { translate } from '../../../i18n/TranslationService'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

export default function SuggestedSection({
    projectId,
    taskByGoalsList,
    dateIndex,
    suggestedUserId,
    isActiveOrganizeMode,
    nestedTaskListIndex,
    instanceKey,
}) {
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)

    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}
    const { photoURL, displayName } = TasksHelper.getUserInProject(projectId, suggestedUserId) || {
        photoURL: `${window.location.origin}/images/generic-user.svg`,
        displayName: translate('Unknown user'),
    }

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        currentUserId,
        taskByGoalsList
    )

    if (!goalsPositionId) return null

    const sortedSuggestedTasks = [...taskByGoalsList]
    sortedSuggestedTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader =
        sortedSuggestedTasks.length > 0 && sortedSuggestedTasks[0][0] !== NOT_PARENT_GOAL_INDEX
    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <Image source={{ uri: photoURL }} style={localStyles.logo} />
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.caption1, { color: colors.Text03 }]}>
                            {translate('Suggested by')} {displayName?.split(' ')[0]}
                        </Text>
                    </View>
                </View>
            </View>

            {sortedSuggestedTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedSuggestedTasks.length - 1 === index
                const goalIndex = taskByGoalsList.findIndex(data => data[0] === goalId)
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
                            subtaskByTask={subtaskByTask}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={taskList}
                            taskListIndex={SUGGESTED_TASK_INDEX}
                            isSuggested={true}
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
                        subtaskByTask={subtaskByTask}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={taskList}
                        taskListIndex={SUGGESTED_TASK_INDEX}
                        containerStyle={{ marginBottom: isLastIndex ? 0 : 32 }}
                        nestedTaskListIndex={nestedTaskListIndex}
                        isSuggested={true}
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
    logo: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
})
