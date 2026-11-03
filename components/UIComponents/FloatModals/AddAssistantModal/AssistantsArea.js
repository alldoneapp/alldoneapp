import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch } from 'react-redux'

import AssistantItem from './AssistantItem'
import { translate } from '../../../../i18n/TranslationService'
import {
    setAssistantLastVisitedBoardDate,
    uploadNewAssistant,
    copyPreConfigTasksToNewAssistant,
    getAssistantTemplateSnapshot,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHeader from '../../../GlobalSearchAlgolia/ResultLists/Common/ProjectHeader'
import { GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'
import NavigationService from '../../../../utils/NavigationService'
import {
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
} from '../../../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import styles, { colors } from '../../../styles/global'
import { splitGlobalTemplates } from './specialistTemplates'

const ALLDONE_TEAM_SECTION_ID = 'alldoneTeamSpecialists'

export default function AssistantsArea({ closeModal, project }) {
    const dispatch = useDispatch()
    const [assistantsByProject, setAssistantsByProject] = useState({})

    const selectAssistant = async (assistantProjectId, assistant) => {
        const sourceAssistantId = assistant.uid
        const sourceProjectId = assistantProjectId === GLOBAL_PROJECT_ID ? GLOBAL_PROJECT_ID : assistantProjectId

        // Wait for the assistant to be created in Firestore
        const assistantPayload = {
            ...assistant,
            noteIdsByProject: {},
            lastVisitBoard: {},
            commentsData: null,
            fromTemplate: false,
            isDefault: false,
            // Track source template assistant for update detection (only when copying from global)
            copiedFromTemplateAssistantId: sourceProjectId === GLOBAL_PROJECT_ID ? assistant.uid : null,
            copiedFromTemplateAssistantDate: sourceProjectId === GLOBAL_PROJECT_ID ? Date.now() : null,
            ...(sourceProjectId === GLOBAL_PROJECT_ID
                ? {
                      templateSyncSnapshot: getAssistantTemplateSnapshot(assistant),
                      templateSyncConflicts: [],
                      templateSyncStatus: 'synced',
                      templateSyncedAt: Date.now(),
                  }
                : {}),
        }

        const newAssistant = await uploadNewAssistant(project.id, assistantPayload, null)

        // Copy pre-configured tasks from the source assistant
        await copyPreConfigTasksToNewAssistant(sourceProjectId, sourceAssistantId, project.id, newAssistant.uid)

        openDvWhenCreateAssistant(newAssistant)
        closeModal()
    }

    const openDvWhenCreateAssistant = assistant => {
        const { loggedUser, globalAssistants } = store.getState()

        NavigationService.navigate('Root')

        const isGlobalAssistant = globalAssistants.find(item => item.uid === assistant.uid)

        setAssistantLastVisitedBoardDate(
            isGlobalAssistant ? GLOBAL_PROJECT_ID : project.id,
            assistant,
            project.id,
            'lastVisitBoard'
        )

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, project.id)

        dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            storeCurrentUser(assistant),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
            setTaskViewToggleIndex(0),
            setTaskViewToggleSection('Open'),
        ])
    }

    useEffect(() => {
        const { loggedUser, loggedUserProjects, projectAssistants, globalAssistants } = store.getState()

        const loggedUserProjectsFiltered = loggedUserProjects.filter(
            assistantProject => assistantProject.id !== project.id
        )

        const activeProjects = ProjectHelper.getProjectsByType2(
            loggedUserProjectsFiltered,
            PROJECT_TYPE_ACTIVE,
            loggedUser
        )
        const guideProjects = ProjectHelper.getProjectsByType2(
            loggedUserProjectsFiltered,
            PROJECT_TYPE_GUIDE,
            loggedUser
        )

        const projects = [{ id: GLOBAL_PROJECT_ID, name: translate('Templates') }, ...activeProjects, ...guideProjects]
        const { specialists, templates } = splitGlobalTemplates(
            globalAssistants,
            project,
            projectAssistants[project.id] || []
        )

        const assistantsByProject = {
            [ALLDONE_TEAM_SECTION_ID]: {
                assistants: specialists,
                // Added like a template, so the copy is created from the global one.
                sourceProjectId: GLOBAL_PROJECT_ID,
                project: { id: ALLDONE_TEAM_SECTION_ID, name: translate('alldone.team specialists') },
            },
        }
        projects.forEach(assistantProject => {
            const assistants =
                assistantProject.id === GLOBAL_PROJECT_ID ? templates : projectAssistants[assistantProject.id]

            assistantsByProject[assistantProject.id] = {
                assistants,
                sourceProjectId: assistantProject.id,
                project: assistantProject,
            }
        })
        setAssistantsByProject(assistantsByProject)
    }, [])

    let assistantsByProjectArray = Object.values(assistantsByProject).filter(item => item.assistants?.length > 0)
    const sectionOrder = item =>
        item.project.id === ALLDONE_TEAM_SECTION_ID ? 0 : item.project.id === GLOBAL_PROJECT_ID ? 1 : 2
    assistantsByProjectArray = [...assistantsByProjectArray].sort((a, b) => sectionOrder(a) - sectionOrder(b))

    return (
        <>
            {assistantsByProjectArray.map(data => {
                const { project, assistants, sourceProjectId } = data
                return (
                    <View key={project.id}>
                        <ProjectHeader
                            project={project}
                            amount={assistants.length}
                            containerStyle={{ marginHorizontal: 0 }}
                        />
                        {project.id === ALLDONE_TEAM_SECTION_ID && (
                            <Text style={localStyles.sectionHint}>{translate('alldone.team specialists hint')}</Text>
                        )}
                        {assistants.map(assistant => (
                            <AssistantItem
                                key={assistant.uid}
                                assistant={assistant}
                                selectAssistant={selectAssistant}
                                assistantProjectId={sourceProjectId}
                            />
                        ))}
                    </View>
                )
            })}
        </>
    )
}

const localStyles = StyleSheet.create({
    sectionHint: {
        ...styles.caption2,
        color: colors.Text03,
        paddingTop: 8,
    },
})
