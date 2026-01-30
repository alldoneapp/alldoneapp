import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import Button from '../../../UIControls/Button'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { translate } from '../../../../i18n/TranslationService'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem, storeCurrentUser } from '../../../../redux/actions'
import store from '../../../../redux/store'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
import {
    removeGlobalAssistantFromProject,
    uploadNewAssistant,
    copyPreConfigTasksToNewAssistant,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { setProjectAssistant } from '../../../../utils/backends/Projects/projectsFirestore'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import UpdateFromTemplate from '../../../AssistantDetailedView/Customizations/UpdateFromTemplate/UpdateFromTemplate'
import { useUpdateAvailable } from '../../../AssistantDetailedView/Customizations/UpdateFromTemplate/useUpdateAvailable'

export default function OpenTasksAssistantData({ projectId }) {
    const dispatch = useDispatch()
    const assistantId = useSelector(state => state.currentUser.uid)
    const displayName = useSelector(state => state.currentUser.displayName)
    const description = useSelector(state => state.currentUser.description)
    const photoURL300 = useSelector(state => state.currentUser.photoURL300)
    const fromTemplate = useSelector(state => state.currentUser.fromTemplate)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const administratorUserId = useSelector(state => state.administratorUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const realGuideProjectIds = useSelector(state => state.loggedUser.realGuideProjectIds)
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const currentUser = useSelector(state => state.currentUser)

    const isGlobal = isGlobalAssistant(assistantId)
    const { isAvailable } = useUpdateAvailable(currentUser)

    const copyToEdit = async () => {
        const { currentUser } = store.getState()
        const project = ProjectHelper.getProjectById(projectId)

        // Wait for the assistant to be created in Firestore
        const newAssistantData = {
            ...currentUser,
            noteIdsByProject: {},
            lastVisitBoard: { [projectId]: { [loggedUserId]: Date.now() } },
            fromTemplate: false,
            isDefault: false,
            // Track source template assistant for update detection
            copiedFromTemplateAssistantId: currentUser.uid,
            copiedFromTemplateAssistantDate: Date.now(),
        }

        const newAssistant = await uploadNewAssistant(projectId, newAssistantData, null)

        // Copy pre-configured tasks from the global assistant
        await copyPreConfigTasksToNewAssistant(GLOBAL_PROJECT_ID, currentUser.uid, projectId, newAssistant.uid)

        if (project.assistantId === assistantId) setProjectAssistant(projectId, newAssistant.uid)

        removeGlobalAssistantFromProject(projectId, currentUser.uid)

        dispatch(storeCurrentUser(newAssistant))
    }

    const navigateToDv = () => {
        if (showFloatPopup === 0) {
            NavigationService.navigate('AssistantDetailedView', {
                assistantId,
                projectId: isGlobalAssistantAndCanBeEdited ? GLOBAL_PROJECT_ID : projectId,
            })
            dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
        }
    }

    const isGlobalAssistantAndCanBeEdited = !isAnonymous && isGlobal && administratorUserId === loggedUserId
    const isNormalAssistantAndCanBeEdited = !isGlobal && !fromTemplate

    const canBeCopiedToEdit =
        !isAnonymous &&
        isGlobal &&
        realProjectIds.includes(projectId) &&
        !realGuideProjectIds.includes(projectId) &&
        (defaultAssistantId !== assistantId || administratorUserId === loggedUserId)

    return (
        <View>
            <Text style={localStyles.name}>{displayName}</Text>
            <AssistantAvatar
                containerStyle={localStyles.avatarContainer}
                photoURL={photoURL300}
                assistantId={assistantId}
                size={113}
            />
            {!!description && <Text style={localStyles.description}>{description}</Text>}
            {(isNormalAssistantAndCanBeEdited || isGlobalAssistantAndCanBeEdited) && (
                <Button
                    type={'ghost'}
                    icon={'edit'}
                    onPress={navigateToDv}
                    title={translate('Edit')}
                    buttonStyle={{ marginTop: 16 }}
                />
            )}
            {isAvailable && (isNormalAssistantAndCanBeEdited || isGlobalAssistantAndCanBeEdited) && (
                <UpdateFromTemplate projectId={projectId} assistant={currentUser} disabled={false} />
            )}
            {canBeCopiedToEdit && (
                <Button
                    type={'ghost'}
                    icon={'edit'}
                    onPress={copyToEdit}
                    title={translate('Copy to edit')}
                    buttonStyle={{ marginTop: 16 }}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    name: {
        ...styles.title6,
        color: colors.Text01,
    },
    description: {
        ...styles.body2,
        color: '#000000',
        marginTop: 25,
    },
    avatarContainer: {
        marginTop: 19,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 16,
    },
})
