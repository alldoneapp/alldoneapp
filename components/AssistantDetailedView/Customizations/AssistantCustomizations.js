import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_CUSTOMIZATIONS } from '../../../URLSystem/Assistants/URLsAssistants'
import CustomizationsHeader from './CustomizationsHeader'
import AssistantDataProperty from './AssistantData/AssistantDataProperty'
import TypeOfAssistantProperty from './TypeOfAssistant/TypeOfAssistantProperty'
import InstructionsProperty from './Instructions/InstructionsProperty'
import ModelProperty from './Model/ModelProperty'
import TemperatureProperty from './Temperature/TemperatureProperty'
import ToolsAccessProperty from './ToolsAccess/ToolsAccessProperty'
import AddPreConfigTask from './PreConfigTasks/AddPreConfigTask'
import PreConfigTaskList from './PreConfigTasks/PreConfigTaskList'
import DeleteAssistant from './DeleteAssistant'
import { unwatch, watchProject } from '../../../utils/backends/firestore'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import DefaultProperty from './Default/DefaultProperty'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import PermissionLevelProperty from './PermissionLevelProperty/PermissionLevelProperty'
import CopyAssistant from './CopyAssistant/CopyAssistant'
import { GLOBAL_PROJECT_ID } from '../../AdminPanel/Assistants/assistantsHelper'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function AssistantCustomizations({
    projectId,
    assistant,
    projectDetailedId,
    isInGlobalProject,
    isGlobalAsisstant,
    isAdmin = false,
}) {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const smallScreen = useSelector(state => state.smallScreen)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUser = useSelector(state => state.loggedUser)
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const [isFromTemplateProject, setIsFromTemplateProject] = useState(true)
    const [isOrganizeMode, setIsOrganizeMode] = useState(false)

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_ASSISTANT_CUSTOMIZATIONS) {
            const data = { projectDetailedId, assistant, assistantId: assistant.uid }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_CUSTOMIZATIONS, data, projectDetailedId, assistant.uid)
        }
    }

    const belongsToProject = isInGlobalProject || loggedUser.realProjectIds.includes(projectDetailedId)
    const canEditAssitant = !isGlobalAsisstant && !isAnonymous && belongsToProject && !assistant.fromTemplate

    const isGuide = !isInGlobalProject && loggedUser.realGuideProjectIds.includes(projectDetailedId)

    const updateIsFromTemplate = templateProject => {
        setIsFromTemplateProject(templateProject ? templateProject.globalAssistantIds.includes(assistant.uid) : false)
    }

    // Toggle organize mode
    const toggleOrganizeMode = () => {
        setIsOrganizeMode(!isOrganizeMode)
    }

    // Render organize button
    const renderOrganizeButton = () => (
        <Button
            type="ghost"
            title={isOrganizeMode ? translate('Done') : translate('Organize')}
            icon={isOrganizeMode ? 'check' : 'move'}
            onPress={toggleOrganizeMode}
            disabled={!canEditAssitant}
        />
    )

    useEffect(() => {
        if (isGlobalAsisstant && isGuide) {
            const watcherKey = v4()

            const guide = ProjectHelper.getProjectById(projectDetailedId)
            watchProject(guide.parentTemplateId, updateIsFromTemplate, watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        } else if (assistant.fromTemplate) {
            setIsFromTemplateProject(true)
        } else {
            setIsFromTemplateProject(false)
        }
    }, [isGuide, isGlobalAsisstant, projectDetailedId, assistant.fromTemplate])

    useEffect(() => {
        writeBrowserURL()
    }, [])

    return (
        <View style={localStyles.container}>
            <CustomizationsHeader text="Basic Settings" containerStyle={{ marginBottom: 24 }} />
            <View style={[localStyles.properties, smallScreen ? localStyles.propertiesMobile : undefined]}>
                <View style={{ flex: 1, marginRight: smallScreen ? 0 : 72, width: smallScreen ? '100%' : '50%' }}>
                    <AssistantDataProperty disabled={!canEditAssitant} projectId={projectId} assistant={assistant} />
                    {isGlobalAsisstant &&
                        !isInGlobalProject &&
                        (!isGuide || isAdmin) &&
                        (defaultAssistantId !== assistant.uid || isAdmin) && (
                            <CopyAssistant
                                projectId={projectDetailedId}
                                assistant={assistant}
                                disabled={isAnonymous || !belongsToProject}
                                sourceProjectId={projectId}
                            />
                        )}
                    <PermissionLevelProperty
                        isGlobal={isGlobalAsisstant || isInGlobalProject}
                        fromTemplate={assistant.fromTemplate}
                    />
                </View>
                <View style={{ flex: 1, width: smallScreen ? '100%' : '50%' }}>
                    <DefaultProperty disabled={!canEditAssitant} assistant={assistant} projectId={projectId} />
                    <TypeOfAssistantProperty
                        disabled={!canEditAssitant || true}
                        projectId={projectId}
                        assistant={assistant}
                    />
                </View>
            </View>
            <CustomizationsHeader text="Assistant Settings" />
            <View style={[localStyles.properties, smallScreen ? localStyles.propertiesMobile : undefined]}>
                <View style={{ flex: 1, marginRight: smallScreen ? 0 : 72, width: smallScreen ? '100%' : '50%' }}>
                    <InstructionsProperty disabled={!canEditAssitant} projectId={projectId} assistant={assistant} />
                    <ModelProperty disabled={!canEditAssitant} projectId={projectId} assistant={assistant} />
                </View>
                <View style={{ flex: 1, width: smallScreen ? '100%' : '50%' }}>
                    <TemperatureProperty disabled={!canEditAssitant} projectId={projectId} assistant={assistant} />
                    <ToolsAccessProperty disabled={!canEditAssitant} projectId={projectId} assistant={assistant} />
                </View>
            </View>
            <CustomizationsHeader text="Assistant tasks" rightContent={canEditAssitant && renderOrganizeButton()} />
            <PreConfigTaskList
                disabled={!canEditAssitant}
                projectId={projectId}
                assistantId={assistant.uid}
                isOrganizeMode={isOrganizeMode && canEditAssitant}
            />
            {canEditAssitant && !isOrganizeMode && (
                <View style={{ marginRight: smallScreen ? 0 : 72, width: '100%' }}>
                    <AddPreConfigTask projectId={projectId} assistantId={assistant.uid} />
                </View>
            )}
            <ObjectRevisionHistory
                projectId={projectDetailedId}
                noteId={assistant.noteIdsByProject[projectDetailedId]}
            />
            {!isAnonymous && belongsToProject && !isFromTemplateProject && !assistant.isDefault && (
                <View style={localStyles.deleteButtonContainer}>
                    <DeleteAssistant
                        isGlobalAsisstant={isGlobalAsisstant}
                        projectId={projectDetailedId}
                        assistant={assistant}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        marginBottom: 92,
    },
    properties: {
        flexDirection: 'row',
    },
    propertiesMobile: {
        flexDirection: 'column',
    },
    deleteButtonContainer: {
        marginTop: 24,
    },
})
