import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import AssistantItem from './AssistantItem'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getDefaultAssistantInProjectById } from '../../../AdminPanel/Assistants/assistantsHelper'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'

export default function AssistantsArea({
    closeModal,
    projectId,
    updateAssistant,
    currentAssistantId,
    includeDefaultProjectAssistant = true,
    defaultProjectAssistantAtEnd = false,
    alwaysUpdateOnSelect = false,
}) {
    const globalAssistants = useSelector(state => state.globalAssistants)
    const assistants = useSelector(state => state.projectAssistants[projectId] || [])
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)

    const project = ProjectHelper.getProjectById(projectId)
    const globalAssistantsInProject = globalAssistants.filter(assistant =>
        project?.globalAssistantIds?.includes(assistant.uid)
    )

    const assistantToShow = [...globalAssistantsInProject, ...assistants]

    // Show "Assistant from default project" option if:
    // 1. There is a default project set
    // 2. The current project is NOT the default project
    // 3. The default project has an assistant
    const isNotDefaultProject = defaultProjectId && projectId !== defaultProjectId
    const defaultProjectAssistant = isNotDefaultProject ? getDefaultAssistantInProjectById(defaultProjectId) : null
    const defaultAssistantAlreadyShown = assistantToShow.some(
        assistant => assistant.uid === defaultProjectAssistant?.uid
    )
    const showDefaultProjectOption =
        includeDefaultProjectAssistant &&
        isNotDefaultProject &&
        defaultProjectAssistant?.uid &&
        !defaultAssistantAlreadyShown

    const defaultProjectAssistantItem = showDefaultProjectOption ? (
        <AssistantItem
            key={'default-project-assistant'}
            projectId={projectId}
            assistant={{
                uid: defaultProjectAssistant.uid,
                displayName: defaultProjectAssistant.displayName,
                description: translate('From your default project'),
                photoURL50: defaultProjectAssistant.photoURL50,
            }}
            updateAssistant={updateAssistant}
            closeModal={closeModal}
            currentAssistantId={currentAssistantId}
            isDefaultProjectOption={true}
            alwaysUpdateOnSelect={alwaysUpdateOnSelect}
        />
    ) : null

    return (
        <View style={{ marginHorizontal: -8 }}>
            {!defaultProjectAssistantAtEnd && defaultProjectAssistantItem}
            {assistantToShow.map(assistant => (
                <AssistantItem
                    key={assistant.uid}
                    projectId={projectId}
                    assistant={assistant}
                    updateAssistant={updateAssistant}
                    closeModal={closeModal}
                    currentAssistantId={currentAssistantId}
                    alwaysUpdateOnSelect={alwaysUpdateOnSelect}
                />
            ))}
            {defaultProjectAssistantAtEnd && defaultProjectAssistantItem && (
                <>
                    {assistantToShow.length > 0 && (
                        <View testID="default-project-assistant-separator" style={localStyles.separator} />
                    )}
                    {defaultProjectAssistantItem}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    separator: {
        height: 1,
        marginHorizontal: 8,
        marginVertical: 4,
        backgroundColor: colors.Text03,
        opacity: 0.2,
    },
})
