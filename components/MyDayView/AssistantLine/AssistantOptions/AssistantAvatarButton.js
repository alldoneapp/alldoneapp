import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import {
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    storeCurrentShortcutUser,
    switchProject,
    hideWebSideBar,
} from '../../../../redux/actions'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { TouchableOpacity } from 'react-native'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_PROJECT_ASSISTANTS } from '../../../../utils/TabNavigationConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../../redux/store'
import URLsProjects, { URL_PROJECT_DETAILS_ASSISTANTS } from '../../../../URLSystem/Projects/URLsProjects'

export default function AssistantAvatarButton({ assistant, projectIndex, size = 24 }) {
    const dispatch = useDispatch()
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { loggedUser, loggedUserProjects } = store.getState()
    const project = loggedUserProjects[projectIndex]

    const navigateToProjectAssistants = () => {
        if (showFloatPopup === 0) {
            // Navigate to the Project Detailed View
            NavigationService.navigate('ProjectDetailedView', {
                projectIndex: projectIndex,
            })

            let dispatches = [
                setSelectedNavItem(DV_TAB_PROJECT_ASSISTANTS),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                storeCurrentShortcutUser(null),
                switchProject(projectIndex),
            ]

            if (smallScreenNavigation) dispatches.push(hideWebSideBar())

            dispatch(dispatches)
            URLsProjects.push(URL_PROJECT_DETAILS_ASSISTANTS, null, project.id)
        }
    }

    return (
        <TouchableOpacity onPress={navigateToProjectAssistants}>
            <AssistantAvatar
                photoURL={assistant.photoURL300}
                assistantId={assistant.uid}
                size={size}
                imageStyle={{ borderRadius: 12 }}
            />
        </TouchableOpacity>
    )
}
