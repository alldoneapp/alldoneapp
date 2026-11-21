import React, { useContext } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import { hideWebSideBar } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import NavigationService from '../../../utils/NavigationService'
import {
    DV_TAB_ROOT_ARTIFACTS,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_WIKI,
    ROOT_ROUTES,
} from '../../../utils/TabNavigationConstants'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { openProjectWiki } from '../../WikiView/wikiLinks'
import { openProjectArtifacts } from '../../ArtifactsView/artifactLinks'
import AnnaWorkspaceNavigationContext from '../../Anna/AnnaWorkspaceNavigationContext'
import { PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import SectionItemLayoutHeader from '../ProjectFolding/SectionItemLayoutHeader'
import { SECTIONS_TOP_ITEMS, getSectionsTopActions, getSelectedSection } from './sectionsTopNavigation'

/**
 * AT-3121: the sections at the top of the "Sections on top" sidebar. They act on the project picked
 * below them (or All projects) and never switch it; the rows are the advanced sidebar's section rows
 * in the neutral All projects colour.
 */
export default function SidebarSectionsTop() {
    const dispatch = useDispatch()
    const showAlldone = useContext(AnnaWorkspaceNavigationContext)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectId = useSelector(state => state.loggedUserProjects[state.selectedProjectIndex]?.id)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const projectId = checkIfSelectedProject(selectedProjectIndex) ? selectedProjectId : null
    const selectedSection = getSelectedSection(selectedSidebarTab, route)

    const onPressSection = tab => e => {
        e?.preventDefault()
        const state = store.getState()
        dismissAllPopups(true, true, true)
        showAlldone()

        // In a project, Wiki and Artifacts open through their URLs like the other sidebar entries do.
        if (projectId && (tab === DV_TAB_ROOT_WIKI || tab === DV_TAB_ROOT_ARTIFACTS)) {
            if (state.smallScreenNavigation) dispatch(hideWebSideBar())
            if (tab === DV_TAB_ROOT_WIKI) openProjectWiki(projectId)
            else openProjectArtifacts(projectId)
            return
        }

        const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)
        dispatch(getSectionsTopActions(state, tab, { projectId, inAllProjects, isGuide }))
        if (tab === DV_TAB_ROOT_TASKS) TasksHelper.setURLOnChangeToggleOption(0, 'Open')
        if (!ROOT_ROUTES.includes(state.route)) NavigationService.navigate('Root')
    }

    return (
        <View style={localStyles.container} testID="sidebar-sections-top">
            {SECTIONS_TOP_ITEMS.map(({ tab, icon, text }) => (
                <View key={tab} nativeID={`sidebar-section-${tab}`}>
                    <SectionItemLayoutHeader
                        icon={icon}
                        text={translate(text)}
                        selected={selectedSection === tab}
                        onPress={onPressSection(tab)}
                        projectColor={PROJECT_COLOR_DEFAULT}
                        inTasks={tab === DV_TAB_ROOT_TASKS}
                        projectId={projectId || undefined}
                        projectSelected={false}
                    />
                </View>
            ))}
            <View
                style={[
                    localStyles.divider,
                    !expanded && localStyles.dividerCollapsed,
                    { borderBottomColor: theme.activeSection.borderBottomColor },
                ]}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 8,
    },
    divider: {
        borderBottomWidth: 1,
        marginTop: 8,
        marginHorizontal: 16,
    },
    dividerCollapsed: {
        marginHorizontal: 10,
    },
})
