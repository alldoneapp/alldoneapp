import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { View } from 'react-native'

import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { hideFloatPopup, hideWebSideBar, setSelectedSidebarTab, storeCurrentUser } from '../../../../redux/actions'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../../../i18n/TranslationService'
import TasksBoards from './TasksBoards'
import store from '../../../../redux/store'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'

export default function Tasks({ navigateToRoot, projectData, projectColor, selected, projectType, isShared }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const onPress = e => {
        e?.preventDefault()

        const { loggedUser, smallScreenNavigation } = store.getState()
        dismissAllPopups(true, true, true)
        const actionsToDispatch = [
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            hideFloatPopup(),
            storeCurrentUser(loggedUser),
        ]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        dispatch(actionsToDispatch)
        TasksHelper.setURLOnChangeToggleOption(0, 'Open')
        navigateToRoot()
    }

    return (
        <View>
            <SectionItemLayoutHeader
                icon={'check-square'}
                text={translate('Tasks')}
                projectSelected={selected}
                selected={selected && checkIfSelectedAllProjects(selectedProjectIndex)}
                lowSelected={selected && checkIfSelectedProject(selectedProjectIndex)}
                onPress={onPress}
                projectColor={projectColor}
                inTasks={true}
                projectId={projectData?.id}
            />
            {projectData && selected && (
                <TasksBoards
                    projectId={projectData.id}
                    projectColor={projectData.color}
                    projectIndex={projectData.index}
                    projectType={projectType}
                    isShared={isShared}
                    globalAssistantIds={projectData.globalAssistantIds}
                />
            )}
        </View>
    )
}
