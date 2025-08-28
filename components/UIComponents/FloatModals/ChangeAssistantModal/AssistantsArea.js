import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AssistantItem from './AssistantItem'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function AssistantsArea({ closeModal, projectId, updateAssistant, currentAssistantId }) {
    const globalAssistants = useSelector(state => state.globalAssistants)
    const assistants = useSelector(state => state.projectAssistants[projectId])

    const project = ProjectHelper.getProjectById(projectId)
    const globalAssistantsInProject = globalAssistants.filter(assistant =>
        project.globalAssistantIds.includes(assistant.uid)
    )

    const assistantToShow = [...globalAssistantsInProject, ...assistants]

    return (
        <View style={{ marginHorizontal: -8 }}>
            {assistantToShow.map(assistant => (
                <AssistantItem
                    key={assistant.uid}
                    projectId={projectId}
                    assistant={assistant}
                    updateAssistant={updateAssistant}
                    closeModal={closeModal}
                    currentAssistantId={currentAssistantId}
                />
            ))}
        </View>
    )
}
