import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import {
    removeGlobalAssistantFromProject,
    uploadNewAssistant,
    copyPreConfigTasksToNewAssistant,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
import NavigationService from '../../../../utils/NavigationService'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { setProjectAssistant } from '../../../../utils/backends/Projects/projectsFirestore'
import { GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function CopyAssistant({ projectId, assistant, disabled, sourceProjectId }) {
    const dispatch = useDispatch()

    const copyToEdit = async () => {
        const project = ProjectHelper.getProjectById(projectId)

        // Wait for the assistant to be created in Firestore
        const assistantPayload = {
            ...assistant,
            noteIdsByProject: {},
            lastVisitBoard: {},
            fromTemplate: false,
            isDefault: false,
        }

        const newAssistant = await uploadNewAssistant(projectId, assistantPayload, null)

        // Copy pre-configured tasks from the source assistant
        const sourceProject = sourceProjectId || GLOBAL_PROJECT_ID
        await copyPreConfigTasksToNewAssistant(sourceProject, assistant.uid, projectId, newAssistant.uid)

        if (project.assistantId === assistant.uid) setProjectAssistant(projectId, newAssistant.uid)

        removeGlobalAssistantFromProject(projectId, assistant.uid)

        NavigationService.navigate('AssistantDetailedView', {
            assistantId: newAssistant.uid,
            projectId,
        })
        dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
    }

    return (
        <View style={localStyles.container}>
            <Icon name="fingerprint" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Permission Level')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Button
                    type={'ghost'}
                    icon={'fingerprint'}
                    onPress={copyToEdit}
                    disabled={disabled}
                    title={translate('Copy to edit')}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
