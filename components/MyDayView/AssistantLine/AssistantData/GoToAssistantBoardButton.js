import React from 'react'
import { useSelector, useDispatch } from 'react-redux'

import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
    switchProject,
    switchShortcutProject,
} from '../../../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { setAssistantLastVisitedBoardDate } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'

export default function GoToAssistantBoardButton({ isAssistant, creator, project }) {
    const dispatch = useDispatch()
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

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
        }
    }

    return (
        <Button
            ref={ref => (this.openBtnRef = ref)}
            title={translate('Open')}
            titleStyle={{ color: colors.Text03, fontSize: 12 }}
            buttonStyle={{ backgroundColor: '#f1f5f7', marginTop: 2 }}
            type={'ghost'}
            noBorder={true}
            icon={'maximize-2'}
            iconSize={18}
            onPress={isAssistant ? navigateToAssistantBoard : navigateToUserBoard}
        />
    )
}
