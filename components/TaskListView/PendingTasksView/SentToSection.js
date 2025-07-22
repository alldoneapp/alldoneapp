import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ParentTaskContainer from '../ParentTaskContainer'
import WorkflowHeader from '../Header/WorkflowHeader'
import { translate } from '../../../i18n/TranslationService'

export default function SendToSection({ taskList, subtaskByTask, projectId, currentStepId, currentStep, assignee }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])

    const reviewer = usersInProject.find(user => user.uid === currentStep.reviewerUid)

    return (
        <View style={localStyles.container}>
            <WorkflowHeader
                reviewer={reviewer}
                assignee={assignee}
                projectId={projectId}
                currentStepId={currentStepId}
                workflowDirectionText={translate('sent to')}
            />
            {taskList.map(task => {
                const subtaskList = subtaskByTask[task.id] ? subtaskByTask[task.id] : []
                return (
                    <ParentTaskContainer
                        key={task.id}
                        task={task}
                        projectId={projectId}
                        subtaskList={subtaskList ? subtaskList : []}
                        isPending={true}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        marginLeft: 2,
    },
})
