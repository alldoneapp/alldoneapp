import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { TouchableOpacity } from 'react-native'

import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import { setAssistantLastVisitedBoardDate } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import {
    hideWebSideBar,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
    switchProject,
} from '../../../../redux/actions'
import store from '../../../../redux/store'
import { DV_TAB_ROOT_TASKS, DV_TAB_USER_PROFILE } from '../../../../utils/TabNavigationConstants'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import ProjectHelper, { checkIfSelectedAllProjects } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../../utils/NavigationService'

export default function AssistantLineAvatar({ creator, project, isAssistant }) {
    const dispatch = useDispatch()
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const navigateToAssistantBoard = () => {
        if (showFloatPopup === 0) {
            const { loggedUser } = store.getState()

            setAssistantLastVisitedBoardDate(
                isGlobalAssistant(creator.uid) ? GLOBAL_PROJECT_ID : project.id,
                creator,
                project.id,
                'lastVisitBoard'
            )

            let dispatches = [
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                storeCurrentUser(creator),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                storeCurrentShortcutUser(null),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
                switchProject(project.index),
            ]

            if (smallScreenNavigation) dispatches.push(hideWebSideBar())

            dispatch(dispatches)
        }
    }

    const navigateToUserBoard = () => {
        if (showFloatPopup === 0) {
            const { loggedUser } = store.getState()
            const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

            if (inAllProjects) {
                ContactsHelper.setUserLastVisitedBoardDate(project.id, creator, 'lastVisitBoard')

                let dispatches = [
                    setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                    storeCurrentUser(creator),
                    setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                    storeCurrentShortcutUser(null),
                    setTaskViewToggleIndex(0),
                    setTaskViewToggleSection('Open'),
                    switchProject(project.index),
                ]

                if (smallScreenNavigation) dispatches.push(hideWebSideBar())

                dispatch(dispatches)
            } else {
                NavigationService.navigate('UserDetailedView', {
                    contact: creator,
                    project,
                })
                dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
            }
        }
    }

    return (
        <TouchableOpacity onPress={isAssistant ? navigateToAssistantBoard : navigateToUserBoard} disabled={!project}>
            <AssistantAvatar
                photoURL={creator.photoURL300 || creator.photoURL}
                assistantId={creator.uid}
                size={100}
                imageStyle={{ borderRadius: 8 }}
            />
        </TouchableOpacity>
    )
}
