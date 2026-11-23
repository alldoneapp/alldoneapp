import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import Tasks from './SectionItems/Tasks'
import Notes from './SectionItems/Notes'
import Contacts from './SectionItems/Contacts'
import {
    DV_TAB_CHAT_PROPERTIES,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    ROOT_ROUTES,
    DV_TAB_ROOT_WIKI,
    DV_TAB_ROOT_ARTIFACTS,
} from '../../../utils/TabNavigationConstants'
import MediaBar from '../../MediaBar/MediaBar'
import Chats from './SectionItems/Chats'
import { PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'
import Goals from './SectionItems/Goals'
import Wiki from './SectionItems/Wiki'
import Artifacts from './SectionItems/Artifacts'
import ProjectSettings from './SectionItems/ProjectSettings'
import AllProjectsSettings from './SectionItems/AllProjectsSettings'
import SectionDivider from './SectionDivider'
import NavigationService from '../../../utils/NavigationService'
import TasksBoards from './SectionItems/TasksBoards'
import { isSectionsTopSidebarNavigation, isSimpleSidebarNavigation } from '../../../utils/SidebarNavigationModes'
import useAnnaAloneSidebar from '../SectionsTop/useAnnaAloneSidebar'

export default function ProjectSectionList({ projectData, projectType, isShared, inAllProjects }) {
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)
    const sidebarNavigationMode = useSelector(state => state.loggedUser.sidebarNavigationMode)

    // AT-3121, "Anna on top": nothing unfolds under a project while Anna is alone on screen, and the
    // sidebar stops at the sections: the people (and the chats' media) are picked on the right, in
    // the project line above the list.
    const { annaAlone } = useAnnaAloneSidebar()
    const sectionsOnly = isSectionsTopSidebarNavigation(sidebarNavigationMode)
    // There the project's settings are the last row; on that screen it is the only one marked. All
    // projects has the same rows as a project, with the general settings last (the sidebar's Settings
    // item, which this sidebar leaves out further down).
    const allProjectsRows = sectionsOnly && inAllProjects
    const onSettings = sectionsOnly && route === (inAllProjects ? 'SettingsView' : 'ProjectDetailedView')
    const ownProject = !!projectData && !isShared
    // Artifacts, Wiki and the settings row follow Chats only here; a quiet line (AT-3139) sets them
    // apart from the main sections. Where nothing follows Chats there is nothing to separate.
    const secondaryRows = ownProject || allProjectsRows

    const projectColor = projectData?.color || PROJECT_COLOR_DEFAULT
    const simpleNavigation = isSimpleSidebarNavigation(sidebarNavigationMode)

    function navigateToRoot() {
        // Navigate to root if not in root
        if (!ROOT_ROUTES.includes(route)) {
            return NavigationService.navigate('Root')
        }
    }

    if (annaAlone) return null

    return simpleNavigation ? (
        <View>
            {projectData && (
                <TasksBoards
                    projectId={projectData.id}
                    projectColor={projectColor}
                    projectIndex={projectData.index}
                    projectType={projectType}
                    isShared={isShared}
                    globalAssistantIds={projectData.globalAssistantIds}
                />
            )}
        </View>
    ) : (
        <View>
            <Tasks
                navigateToRoot={navigateToRoot}
                projectData={projectData}
                projectColor={projectColor}
                selected={!onSettings && (selectedSidebarTab === DV_TAB_ROOT_TASKS || route === 'TaskDetailedView')}
                projectType={projectType}
                isShared={isShared}
                showBoards={!sectionsOnly}
            />

            <Goals
                navigateToRoot={navigateToRoot}
                projectData={projectData}
                projectColor={projectColor}
                selected={!onSettings && (selectedSidebarTab === DV_TAB_ROOT_GOALS || route === 'GoalDetailedView')}
                projectType={projectType}
                isShared={isShared}
                showBoards={!sectionsOnly}
            />
            <Notes
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={!onSettings && (selectedSidebarTab === DV_TAB_ROOT_NOTES || route === 'NotesDetailedView')}
            />
            <Contacts
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={
                    !onSettings &&
                    (selectedSidebarTab === DV_TAB_ROOT_CONTACTS ||
                        route === 'UserDetailedView' ||
                        route === 'ContactDetailedView')
                }
            />
            <Chats
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={
                    !onSettings &&
                    (selectedSidebarTab === DV_TAB_ROOT_CHATS ||
                        selectedNavItem === DV_TAB_CHAT_PROPERTIES ||
                        route === 'ChatDetailedView')
                }
                projectId={projectData?.id}
                inAllProjects={inAllProjects}
            />
            {secondaryRows && <SectionDivider projectColor={projectColor} />}
            {secondaryRows && (
                <Artifacts
                    projectId={projectData?.id}
                    projectColor={projectColor}
                    navigateToRoot={navigateToRoot}
                    selected={
                        !onSettings && selectedSidebarTab === DV_TAB_ROOT_ARTIFACTS && route !== 'ProjectDetailedView'
                    }
                />
            )}
            {secondaryRows && (
                <Wiki
                    projectId={projectData?.id}
                    projectColor={projectColor}
                    navigateToRoot={navigateToRoot}
                    selected={!onSettings && selectedSidebarTab === DV_TAB_ROOT_WIKI && route !== 'ProjectDetailedView'}
                />
            )}
            {sectionsOnly && ownProject && (
                <ProjectSettings projectIndex={projectData.index} projectColor={projectColor} selected={onSettings} />
            )}
            {allProjectsRows && <AllProjectsSettings projectColor={projectColor} selected={onSettings} />}
            {(selectedSidebarTab === DV_TAB_ROOT_CHATS || route === 'ChatDetailedView') &&
                !isShared &&
                projectData &&
                !sectionsOnly && <MediaBar projectColor={projectColor} projectId={projectData.id} />}
        </View>
    )
}
