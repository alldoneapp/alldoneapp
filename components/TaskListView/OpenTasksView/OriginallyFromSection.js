import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import WorkflowHeader from '../Header/WorkflowHeader'
import { WORKFLOW_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import { translate } from '../../../i18n/TranslationService'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

export default function OriginallyFromSection({
    projectId,
    taskByGoalsList,
    assigneeId,
    dateIndex,
    isActiveOrganizeMode,
    nestedTaskListIndex,
    instanceKey,
}) {
    const currentUser = useSelector(state => state.currentUser)
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])

    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}

    const owner = usersInProject.find(user => user.uid === assigneeId)
    const historyIndex = taskByGoalsList[0][1][0].stepHistory.length - 1
    const currentStepId = taskByGoalsList[0][1][0].stepHistory[historyIndex]

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        assigneeId,
        taskByGoalsList
    )

    if (!goalsPositionId) return null

    const sortedWorkflowTasks = [...taskByGoalsList]
    sortedWorkflowTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader = sortedWorkflowTasks.length > 0 && sortedWorkflowTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    return owner ? (
        <View style={localStyles.container}>
            <WorkflowHeader
                projectId={projectId}
                assignee={owner}
                reviewer={currentUser}
                currentStepId={currentStepId}
                workflowDirectionText={translate('from')}
            />

            {sortedWorkflowTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedWorkflowTasks.length - 1 === index
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
                            taskListIndex={WORKFLOW_TASK_INDEX}
                            isToReviewTask={true}
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
                        taskListIndex={WORKFLOW_TASK_INDEX}
                        containerStyle={isLastIndex ? null : { marginBottom: 16 }}
                        nestedTaskListIndex={nestedTaskListIndex}
                        goalIndex={goalIndex}
                        instanceKey={instanceKey}
                        isToReviewTask={true}
                    />
                )
            })}
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
})
