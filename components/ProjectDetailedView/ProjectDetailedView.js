import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import Header from './Header/Header'
import BackButton from './Header/BackButton'
import { setNavigationRoute, switchProject } from '../../redux/actions'
import ProjectMembers from './ProjectMembers/ProjectMembers'
import ProjectProperties from './ProjectProperties/ProjectProperties'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import RootViewFeedsProject from '../Feeds/RootViewFeedsProject'
import CustomScrollView from '../UIControls/CustomScrollView'
import {
    DV_TAB_PROJECT_BACKLINKS,
    DV_TAB_PROJECT_PROPERTIES,
    DV_TAB_PROJECT_TEAM_MEMBERS,
    DV_TAB_PROJECT_UPDATES,
    DV_TAB_PROJECT_WORKSTREAMS,
    DV_TAB_PROJECT_STATISTICS,
    DV_TAB_PROJECT_ASSISTANTS,
    DV_TAB_PROJECT_CONTACT_STATUSES,
} from '../../utils/TabNavigationConstants'
import { LINKED_OBJECT_TYPE_PROJECT } from '../../utils/LinkingHelper'
import BacklinksView from '../BacklinksView/BacklinksView'
import ProjectWorkstreams from '../Workstreams/ProjectWorkstreams'
import { useDispatch, useSelector } from 'react-redux'
import SharedHelper from '../../utils/SharedHelper'
import StatisticsView from './Statistics/StatisticsView'
import LoadingData from '../UIComponents/LoadingData'
import Assistants from './Assistants/Assistants'
import ContactStatusSettings from './ProjectProperties/ContactStatusSettings/ContactStatusSettings'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

const ProjectDetailedView = ({ navigation }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectIndex = navigation.getParam('projectIndex', undefined)
    const project = useSelector(state => state.loggedUserProjects[projectIndex])
    const type = ProjectHelper.getTypeOfProject(loggedUser, project.id)
    const dispatch = useDispatch()

    const { overlay } = useCollapsibleSidebar()

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_PROJECT,
        id: project.id,
        idsField: 'linkedParentProjectsIds',
    }

    const navigationTabs = [
        DV_TAB_PROJECT_PROPERTIES,
        DV_TAB_PROJECT_STATISTICS,
        DV_TAB_PROJECT_BACKLINKS,
        DV_TAB_PROJECT_TEAM_MEMBERS,
        DV_TAB_PROJECT_WORKSTREAMS,
        DV_TAB_PROJECT_ASSISTANTS,
        DV_TAB_PROJECT_CONTACT_STATUSES,
        DV_TAB_PROJECT_UPDATES,
    ]

    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    if (!accessGranted) {
        const indexST = navigationTabs.indexOf(DV_TAB_PROJECT_STATISTICS)
        navigationTabs.splice(indexST, 1)
        const indexBL = navigationTabs.indexOf(DV_TAB_PROJECT_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
        const indexTM = navigationTabs.indexOf(DV_TAB_PROJECT_TEAM_MEMBERS)
        navigationTabs.splice(indexTM, 1)
    }
    if (project.parentTemplateId) {
        const indexST = navigationTabs.indexOf(DV_TAB_PROJECT_WORKSTREAMS)
        navigationTabs.splice(indexST, 1)
    }

    useEffect(() => {
        dispatch(setNavigationRoute('ProjectDetailedView'))
    }, [])

    useEffect(() => {
        dispatch(switchProject(project.index))
    }, [selectedTab])

    return (
        <View style={localStyles.container}>
            <LoadingData />

            {((!loggedUser.isAnonymous && !mobile) || (loggedUser.isAnonymous && mobile && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}

            <View style={{ flex: 1 }}>
                {!isMiddleScreen && accessGranted && (
                    <View style={localStyles.backButton}>
                        <BackButton project={project} />
                    </View>
                )}

                <CustomScrollView
                    style={[
                        localStyles.scrollPanel,
                        mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                        overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                    ]}
                >
                    <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
                        <Header project={project} />
                        <View style={{ flex: 1 }}>
                            <View style={mobile ? localStyles.navigationBar : undefined}>
                                <NavigationBar taskDetail isSecondary tabs={navigationTabs} />
                            </View>
                            {(() => {
                                switch (selectedTab) {
                                    case DV_TAB_PROJECT_PROPERTIES:
                                        return <ProjectProperties project={project} type={type} />
                                    case DV_TAB_PROJECT_TEAM_MEMBERS:
                                        return <ProjectMembers project={project} />
                                    case DV_TAB_PROJECT_ASSISTANTS:
                                        return <Assistants accessGranted={accessGranted} project={project} />
                                    case DV_TAB_PROJECT_WORKSTREAMS:
                                        return <ProjectWorkstreams project={project} />
                                    case DV_TAB_PROJECT_UPDATES:
                                        return <RootViewFeedsProject projectId={project.id} />
                                    case DV_TAB_PROJECT_STATISTICS:
                                        return <StatisticsView projectId={project.id} userId={loggedUser.uid} />
                                    case DV_TAB_PROJECT_BACKLINKS:
                                        return (
                                            <BacklinksView
                                                project={project}
                                                linkedParentObject={linkedParentObject}
                                                externalStyle={{ marginHorizontal: 0 }}
                                            />
                                        )
                                    case DV_TAB_PROJECT_CONTACT_STATUSES:
                                        return <ContactStatusSettings project={project} />
                                }
                            })()}
                        </View>
                    </View>
                </CustomScrollView>
            </View>

            {!mobile && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
        </View>
    )
}

export default ProjectDetailedView

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
    backButton: {
        position: 'absolute',
        top: 0,
        left: 32,
        zIndex: 100,
    },
    scrollPanel: {
        flex: 1,
        flexDirection: 'column',
        backgroundColor: 'white',
        paddingHorizontal: 104,
    },
    scrollPanelMobile: {
        paddingHorizontal: 16,
    },
    scrollPanelTablet: {
        paddingHorizontal: 56,
    },
    navigationBar: {
        marginHorizontal: -16,
    },
})
