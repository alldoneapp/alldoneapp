import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import {
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    storeCurrentShortcutUser,
    switchProject,
    hideWebSideBar,
} from '../../../../redux/actions'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { TouchableOpacity } from 'react-native'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../../redux/store'
import { setAssistantLastVisitedBoardDate } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function AssistantAvatarButton({ assistant, projectIndex, size = 24 }) {
    const dispatch = useDispatch()
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { loggedUser, loggedUserProjects } = store.getState()
    const project = loggedUserProjects[projectIndex]

    const navigateToAssistantBoard = () => {
        if (showFloatPopup === 0) {
            if (!project || !assistant) return

            setAssistantLastVisitedBoardDate(
                isGlobalAssistant(assistant.uid) ? GLOBAL_PROJECT_ID : project.id,
                assistant,
                project.id,
                'lastVisitBoard'
            )

            let dispatches = [
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                storeCurrentUser(assistant),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                storeCurrentShortcutUser(null),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
                switchProject(projectIndex),
            ]

            if (smallScreenNavigation) dispatches.push(hideWebSideBar())

            dispatch(dispatches)
        }
    }

    return (
        <TouchableOpacity onPress={navigateToAssistantBoard}>
            <AssistantAvatar
                photoURL={assistant.photoURL300}
                assistantId={assistant.uid}
                size={size}
                imageStyle={{ borderRadius: 12 }}
            />
        </TouchableOpacity>
    )
}
