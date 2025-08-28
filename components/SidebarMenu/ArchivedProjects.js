import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../redux/store'
import { PROJECT_TYPE_ARCHIVED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import styles from '../styles/global'
import {
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
    updateFeedActiveTab,
} from '../../redux/actions'
import NavigationService from '../../utils/NavigationService'
import URLsTasks, { URL_PROJECT_USER_TASKS } from '../../URLSystem/Tasks/URLsTasks'
import { FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
import ArchivedProjectsList from './ArchivedProjectsList'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function ArchivedProjects({ navigation }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)

    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ArchivedProjects')
    let active = checkIfSelectedProject(selectedProjectIndex) && selectedTypeOfProject === PROJECT_TYPE_ARCHIVED

    const activeArchived = async () => {
        const { loggedUser } = store.getState()
        const { realArchivedProjectIds } = loggedUser
        if (realArchivedProjectIds.length > 0) {
            window.location = `/projects/${realArchivedProjectIds[0]}/user/${loggedUser.uid}/tasks/open`
        }
    }

    const onPress = () => {
        const { loggedUser, loggedUserProjects, areArchivedActive } = store.getState()

        if (areArchivedActive) {
            let archivedProjects = ProjectHelper.getArchivedProjectsInList(
                loggedUserProjects,
                loggedUser.archivedProjectIds
            )

            if (archivedProjects.length > 0) {
                archivedProjects = ProjectHelper.sortProjects(archivedProjects, loggedUser.uid)
                const data = { projectId: archivedProjects[0].id, userId: loggedUserId }

                URLsTasks.push(URL_PROJECT_USER_TASKS, data, data.projectId, data.userId)

                dispatch([
                    setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                    switchProject(archivedProjects[0].index),
                    updateFeedActiveTab(FOLLOWED_TAB),
                    setTaskViewToggleIndex(0),
                    setTaskViewToggleSection('Open'),
                    storeCurrentUser(loggedUser),
                    setSelectedTypeOfProject(PROJECT_TYPE_ARCHIVED),
                ])
                NavigationService.navigate('Root')
            }
        } else {
            activeArchived()
        }
    }

    return (
        <View style={{ marginTop: 32 }}>
            <View>
                <TouchableOpacity
                    style={[
                        localStyles.container,
                        !expanded && localStyles.containerCollapsed,
                        hover && theme.containerHover,
                    ]}
                    onPress={onPress}
                    onMouseEnter={onHover}
                    onMouseLeave={offHover}
                >
                    <View style={localStyles.titleContainer}>
                        <View style={localStyles.innerContainer}>
                            <Icon
                                size={22}
                                name={'archive'}
                                color={active ? theme.textActive.color : theme.text.color}
                                style={{
                                    marginRight: 10,
                                    opacity: active ? theme.textActive.opacity : theme.text.opacity,
                                }}
                            />
                            {expanded && (
                                <Text style={[localStyles.text, active ? theme.textActive : theme.text]}>
                                    {translate('Archived')}
                                </Text>
                            )}
                        </View>
                    </View>
                </TouchableOpacity>

                {selectedTypeOfProject === PROJECT_TYPE_ARCHIVED && <ArchivedProjectsList navigation={navigation} />}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingLeft: 24,
        justifyContent: 'center',
        height: 56,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    text: {
        ...styles.body1,
    },
    tasksAmountContainer: {
        flexDirection: 'row',
        paddingRight: 24,
    },
    tasksAmountCollapsed: {
        top: 3,
        right: 9,
        position: 'absolute',
        flexDirection: 'row',
    },
    innerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
