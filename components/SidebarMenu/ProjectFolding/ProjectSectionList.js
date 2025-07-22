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
} from '../../../utils/TabNavigationConstants'
import MediaBar from '../../MediaBar/MediaBar'
import Chats from './SectionItems/Chats'
import { PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'
import Goals from './SectionItems/Goals'
import NavigationService from '../../../utils/NavigationService'

export default function ProjectSectionList({ projectData, projectType, isShared, inAllProjects }) {
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)

    const projectColor = projectData?.color || PROJECT_COLOR_DEFAULT

    function navigateToRoot() {
        // Navigate to root if not in root
        if (!ROOT_ROUTES.includes(route)) {
            return NavigationService.navigate('Root')
        }
    }

    return (
        <View>
            <Tasks
                navigateToRoot={navigateToRoot}
                projectData={projectData}
                projectColor={projectColor}
                selected={selectedSidebarTab === DV_TAB_ROOT_TASKS || route === 'TaskDetailedView'}
                projectType={projectType}
                isShared={isShared}
            />

            <Goals
                navigateToRoot={navigateToRoot}
                projectData={projectData}
                projectColor={projectColor}
                selected={selectedSidebarTab === DV_TAB_ROOT_GOALS || route === 'GoalDetailedView'}
                projectType={projectType}
                isShared={isShared}
            />
            <Notes
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={selectedSidebarTab === DV_TAB_ROOT_NOTES || route === 'NotesDetailedView'}
            />
            <Contacts
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={
                    selectedSidebarTab === DV_TAB_ROOT_CONTACTS ||
                    route === 'UserDetailedView' ||
                    route === 'ContactDetailedView'
                }
            />
            <Chats
                navigateToRoot={navigateToRoot}
                projectColor={projectColor}
                selected={
                    selectedSidebarTab === DV_TAB_ROOT_CHATS ||
                    selectedNavItem === DV_TAB_CHAT_PROPERTIES ||
                    route === 'ChatDetailedView'
                }
                projectId={projectData?.id}
                inAllProjects={inAllProjects}
            />
            {(selectedSidebarTab === DV_TAB_ROOT_CHATS || route === 'ChatDetailedView') && !isShared && projectData && (
                <MediaBar projectColor={projectColor} projectId={projectData.id} />
            )}
        </View>
    )
}
