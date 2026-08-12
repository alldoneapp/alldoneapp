import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'

import store from '../../../redux/store'
import ProjectHelper from '../ProjectsSettings/ProjectHelper'
import SelectSimpleProjectListModal from '../../UIComponents/FloatModals/SelectSimpleProjectListModal'
import { translate } from '../../../i18n/TranslationService'
import { setSelectedNavItem, switchProject } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_PROJECT_STATISTICS } from '../../../utils/TabNavigationConstants'

export default function SelectProjectModalInInvoceGeneration({ closeModal }) {
    const dispatch = useDispatch()
    const [projects, setProjects] = useState([])

    const navigateToProject = projectIndex => {
        dispatch([setSelectedNavItem(DV_TAB_PROJECT_STATISTICS), switchProject(projectIndex)])
        NavigationService.navigate('ProjectDetailedView', {
            projectIndex,
        })
    }

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { projectIds, archivedProjectIds, templateProjectIds, guideProjectIds } = loggedUser
        const activeProjects = ProjectHelper.getActiveProjectsInList(
            loggedUserProjects,
            projectIds,
            archivedProjectIds,
            templateProjectIds,
            guideProjectIds
        )
        const sortedProjects = ProjectHelper.sortProjects(activeProjects, loggedUser.uid)
        setProjects(sortedProjects)
    }, [])

    return (
        <SelectSimpleProjectListModal
            closeModal={closeModal}
            projects={projects}
            title={translate('Select one of the projects')}
            description={translate('You need to select a project to generate an invoice')}
            onSelectProject={navigateToProject}
        />
    )
}
