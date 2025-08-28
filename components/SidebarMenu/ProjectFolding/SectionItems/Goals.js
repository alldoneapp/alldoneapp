import React from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
    hideFloatPopup,
    hideWebSideBar,
    setGoalsActiveTab,
    setSelectedSidebarTab,
    storeCurrentUser,
} from '../../../../redux/actions'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { DV_TAB_ROOT_GOALS } from '../../../../utils/TabNavigationConstants'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../../../i18n/TranslationService'
import GoalsBoards from './GoalsBoards'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import store from '../../../../redux/store'
import { GOALS_OPEN_TAB_INDEX } from '../../../GoalsView/GoalsHelper'
import { allGoals } from '../../../AllSections/allSectionHelper'

export default function Goals({ navigateToRoot, projectData, projectColor, selected, projectType, isShared }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const onPress = e => {
        e?.preventDefault()
        const { smallScreenNavigation, loggedUser } = store.getState()

        const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)

        const newCurrentUser = isGuide ? loggedUser : allGoals

        dismissAllPopups(true, true, true)
        const actionsToDispatch = [
            setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            hideFloatPopup(),
            storeCurrentUser(newCurrentUser),
            setGoalsActiveTab(GOALS_OPEN_TAB_INDEX),
        ]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        dispatch(actionsToDispatch)
        navigateToRoot()
    }

    return (
        <View>
            <SectionItemLayoutHeader
                icon={'target'}
                text={translate('Goals')}
                selected={selected && checkIfSelectedAllProjects(selectedProjectIndex)}
                lowSelected={selected && checkIfSelectedProject(selectedProjectIndex)}
                onPress={onPress}
                projectColor={projectColor}
            />
            {projectData && selected && (
                <GoalsBoards
                    projectId={projectData.id}
                    projectColor={projectData.color}
                    projectIndex={projectData.index}
                    projectType={projectType}
                    isShared={isShared}
                    selected={selected}
                />
            )}
        </View>
    )
}
