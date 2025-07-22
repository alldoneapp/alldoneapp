import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import SelectSimpleProjectListModal from '../../../UIComponents/FloatModals/SelectSimpleProjectListModal'
import { translate } from '../../../../i18n/TranslationService'
import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
    storeLoggedUser,
} from '../../../../redux/actions'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import { PROJECT_TYPE_GUIDE } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import { getGuides } from '../../../../utils/backends/firestore'

export default function SelectProjectModalInGuideProjectsProperty({ closeModal, projectId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [projects, setProjects] = useState([])

    const navigateToProject = async (projectIndex, project) => {
        const { smallScreenNavigation, loggedUser, activeGuideId } = store.getState()
        const { realGuideProjectIds } = loggedUser

        const isInactive = activeGuideId !== project.id && realGuideProjectIds.includes(project.id)
        if (projectIndex >= 0) {
            dispatch([
                storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }),
                switchProject(projectIndex),
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                storeCurrentUser(loggedUser),
                setSelectedTypeOfProject(PROJECT_TYPE_GUIDE),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
            ])
            NavigationService.navigate('Root')
            if (smallScreenNavigation) dispatch(hideWebSideBar())
        } else if (isInactive) {
            window.location = `/projects/${project.id}/user/${loggedUser.uid}/tasks/open`
        } else {
            const data = { project, user: loggedUser }
            ProjectHelper.showModalForJointToProject(NavigationService, data)
        }
        closeModal()
    }

    useEffect(() => {
        getGuides(projectId).then(guides => {
            const sortedProjects = ProjectHelper.sortProjects(guides, loggedUserId)
            setProjects(sortedProjects)
        })
    }, [])

    return (
        <SelectSimpleProjectListModal
            closeModal={closeModal}
            projects={projects}
            title={translate('Select one of the projects')}
            description={translate('You need to select a project to go there')}
            onSelectProject={navigateToProject}
        />
    )
}
