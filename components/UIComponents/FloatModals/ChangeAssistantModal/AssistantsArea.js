import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AssistantItem from './AssistantItem'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getDefaultAssistantInProjectById } from '../../../AdminPanel/Assistants/assistantsHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function AssistantsArea({ closeModal, projectId, updateAssistant, currentAssistantId }) {
    const globalAssistants = useSelector(state => state.globalAssistants)
    const assistants = useSelector(state => state.projectAssistants[projectId])
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)

    const project = ProjectHelper.getProjectById(projectId)
    const globalAssistantsInProject = globalAssistants.filter(assistant =>
        project.globalAssistantIds.includes(assistant.uid)
    )

    const assistantToShow = [...globalAssistantsInProject, ...assistants]

    // Show "Assistant from default project" option if:
    // 1. There is a default project set
    // 2. The current project is NOT the default project
    // 3. The default project has an assistant
    const isNotDefaultProject = defaultProjectId && projectId !== defaultProjectId
    const defaultProjectAssistant = isNotDefaultProject ? getDefaultAssistantInProjectById(defaultProjectId) : null
    const showDefaultProjectOption = isNotDefaultProject && defaultProjectAssistant

    return (
        <View style={{ marginHorizontal: -8 }}>
            {showDefaultProjectOption && (
                <AssistantItem
                    key={'default-project-assistant'}
                    projectId={projectId}
                    assistant={{
                        uid: null, // null means "use default project's assistant"
                        displayName: translate('Assistant from default project'),
                        description: translate('Uses the assistant from your default project'),
                        photoURL50: defaultProjectAssistant.photoURL50,
                    }}
                    updateAssistant={updateAssistant}
                    closeModal={closeModal}
                    currentAssistantId={currentAssistantId}
                    isDefaultProjectOption={true}
                />
            )}
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
