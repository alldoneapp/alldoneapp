import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { dismissAllPopups, popoverToSafePosition } from '../../../utils/HelperFunctions'
import {
    setSelectedNavItem,
    setSelectedTypeOfProject,
    storeCurrentUser,
    switchProject,
    storeLoggedUser,
} from '../../../redux/actions'
import styles, { colors } from '../../styles/global'
import { PROJECT_TYPE_ACTIVE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper, { ALL_PROJECTS_INDEX } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SelectProjectModalInSearch, {
    ALL_PROJECTS_OPTION,
} from '../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import { translate } from '../../../i18n/TranslationService'
import NavigationService from '../../../utils/NavigationService'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import { DV_TAB_PROJECT_PROPERTIES, DV_TAB_ROOT_GOALS } from '../../../utils/TabNavigationConstants'
import { allGoals } from '../../AllSections/allSectionHelper'
import withSafePopover from '../../UIComponents/HOC/withSafePopover'
import Popover from 'react-tiny-popover'

function ProjectLine({ projectIndex, user, badge, openPopover, closePopover, isOpen }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[projectIndex])
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()

    const onProjectClick = projectId => {
        const projectType =
            projectId === ALL_PROJECTS_OPTION
                ? PROJECT_TYPE_ACTIVE
                : ProjectHelper.getTypeOfProject(loggedUser, projectId)
        const projectIndex =
            projectId === ALL_PROJECTS_OPTION ? ALL_PROJECTS_INDEX : ProjectHelper.getProjectIndexById(projectId)

        if (selectedProjectIndex === projectIndex && selectedProjectIndex > 0) {
            NavigationService.navigate('ProjectDetailedView', {
                projectIndex,
            })
            dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
        } else {
            const isGuide = ProjectHelper.checkIfProjectIsGuide(projectIndex)
            const newCurrentUser = selectedSidebarTab === DV_TAB_ROOT_GOALS && !isGuide ? allGoals : loggedUser

            if (projectId !== ALL_PROJECTS_OPTION) {
                dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
            }

            dispatch([
                switchProject(projectIndex),
                storeCurrentUser(newCurrentUser),
                setSelectedTypeOfProject(projectType || PROJECT_TYPE_ACTIVE),
            ])
        }

        closePopover()
        dismissAllPopups()
    }

    const navigateToProjectFromAllProjects = () => {
        if (loggedUser.isAnonymous) {
            openProjectDetailView()
        } else {
            if (selectedProjectIndex === project.index) {
                openPopover()
            } else {
                const isGuide = ProjectHelper.checkIfProjectIsGuide(project.index)
                let newCurrentUser = isGuide ? loggedUser : user

                if (!isGuide && selectedSidebarTab === DV_TAB_ROOT_GOALS) {
                    newCurrentUser = allGoals
                }

                dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
                dispatch([switchProject(project.index), storeCurrentUser(newCurrentUser)])
            }
        }
    }

    const openProjectDetailView = () => {
        NavigationService.navigate('ProjectDetailedView', {
            projectIndex: project.index,
        })
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
    }

    const trigger = (
        <TouchableOpacity
            style={[localStyles.titleContainer, { flex: 1 }]}
            onPress={navigateToProjectFromAllProjects}
            accessible={false}
        >
            <View style={[localStyles.titleContainer, { flex: 1 }]}>
                <ColoredCircleSmall
                    size={16}
                    color={project.color}
                    isGuide={!!project.parentTemplateId}
                    containerStyle={{ marginHorizontal: 4 }}
                    projectId={project.id}
                />
                <Text style={[styles.subtitle1, localStyles.projectName]} numberOfLines={1}>
                    {project.name}
                </Text>
                {badge}
            </View>
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            position={mobile ? ['bottom'] : ['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            disableReposition={true}
            onClickOutside={closePopover}
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
            content={
                isOpen && (
                    <SelectProjectModalInSearch
                        projectId={project.id}
                        closePopover={closePopover}
                        projects={loggedUserProjects}
                        headerText={translate('Switch project')}
                        subheaderText={translate('Select the project to switch to')}
                        setSelectedProjectId={onProjectClick}
                        positionInPlace={true}
                        showGuideTab={true}
                        showTemplateTab={loggedUser.realTemplateProjectIds.length > 0}
                        showArchivedTab={true}
                        showAllProjects={true}
                    />
                )
            }
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    projectName: {
        paddingLeft: 4,
        color: colors.Text01,
    },
})

export default withSafePopover(ProjectLine)
