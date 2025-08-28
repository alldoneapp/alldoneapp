import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import PendingTasksByDate from '../../TaskListView/PendingTasksView/PendingTasksByDate'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalWorkflowTasksSection({ projectId }) {
    const goalWorkflowTasksData = useSelector(state => state.goalWorkflowTasksData)
    const goalWorkflowSubtasksByParent = useSelector(state => state.goalWorkflowSubtasksByParent)

    const project = ProjectHelper.getProjectById(projectId)

    return (
        <>
            <View style={{ marginBottom: 32 }}>
                {goalWorkflowTasksData.map((tasksData, index) => {
                    return (
                        <View key={tasksData[0]}>
                            <PendingTasksByDate
                                project={project}
                                dateFormated={tasksData[0]}
                                firstDateSection={index === 0}
                                tasksByStep={tasksData[3]}
                                subtaskByTask={goalWorkflowSubtasksByParent}
                                estimation={tasksData[2]}
                                amountTasks={tasksData[1]}
                            />
                        </View>
                    )
                })}
            </View>
        </>
    )
}
