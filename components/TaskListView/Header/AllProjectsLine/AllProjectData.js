import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import { dismissAllPopups, popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { setSelectedTypeOfProject, storeCurrentUser, switchProject, storeLoggedUser } from '../../../../redux/actions'
import { PROJECT_TYPE_ACTIVE } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import SelectProjectModalInSearch, {
    ALL_PROJECTS_OPTION,
} from '../../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_ROOT_GOALS } from '../../../../utils/TabNavigationConstants'
import { allGoals } from '../../../AllSections/allSectionHelper'
import AllProjectsButton from './AllProjectsButton'

export default function AllProjectData() {
    const dispatch = useDispatch()
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [showPopup, setShowPopup] = useState(false)

    const closePopover = () => {
        setShowPopup(false)
    }

    const openPopover = () => {
        setShowPopup(true)
    }

    const onProjectClick = projectId => {
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId) || PROJECT_TYPE_ACTIVE

        const isGuide = ProjectHelper.checkIfProjectIsGuide(projectIndex)
        const newCurrentUser = selectedSidebarTab === DV_TAB_ROOT_GOALS && !isGuide ? allGoals : loggedUser

        if (projectId !== ALL_PROJECTS_OPTION) {
            dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
        }

        dispatch([switchProject(projectIndex), storeCurrentUser(newCurrentUser), setSelectedTypeOfProject(projectType)])

        closePopover()
        dismissAllPopups()
    }

    return (
        <Popover
            content={
                showPopup && (
                    <SelectProjectModalInSearch
                        projectId={ALL_PROJECTS_OPTION}
                        closePopover={closePopover}
                        projects={loggedUserProjects}
                        headerText={translate('Switch project')}
                        subheaderText={translate('Select the project to switch to')}
                        setSelectedProjectId={onProjectClick}
                        positionInPlace={true}
                        showGuideTab={true}
                        showTemplateTab={loggedUser.realTemplateProjectIds.length > 0}
                        showArchivedTab={true}
                    />
                )
            }
            onClickOutside={closePopover}
            isOpen={showPopup}
            position={mobile ? ['bottom'] : ['bottom', 'top', 'right', 'left']}
            align={'start'}
            padding={4}
            disableReposition={true}
            containerStyle={
                mobile
                    ? {
                          maxHeight: '80vh',
                          overflow: 'auto',
                          position: 'fixed',
                          zIndex: 9999,
                      }
                    : undefined
            }
            contentLocation={
                mobile
                    ? args => {
                          // Force position for small screens
                          return { top: 60, left: 16 }
                      }
                    : args => popoverToSafePosition(args, mobile)
            }
        >
            <AllProjectsButton onPress={openPopover} />
        </Popover>
    )
}
