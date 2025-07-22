import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import Header from './Header/Header'
import BackButton from './Header/BackButton'
import WorkflowView from '../WorkflowView/WorkflowView'
import StatisticsView from '../ProjectDetailedView/Statistics/StatisticsView'
import UserProperties from './UserProperties/UserProperties'
import {
    navigateToAllProjectsTasks,
    resetFloatPopup,
    resetLoadingData,
    setNavigationRoute,
    setSelectedSidebarTab,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
    switchProject,
} from '../../redux/actions'
import store from '../../redux/store'
import LoadingData from '../UIComponents/LoadingData'
import RootViewFeedsUser from '../Feeds/RootViewFeedsUser'
import { URL_PEOPLE_DETAILS } from '../../URLSystem/People/URLsPeople'
import CustomScrollView from '../UIControls/CustomScrollView'
import BacklinksView from '../BacklinksView/BacklinksView'
import {
    DV_TAB_USER_BACKLINKS,
    DV_TAB_USER_PROPERTIES,
    DV_TAB_USER_STATISTICS,
    DV_TAB_USER_UPDATES,
    DV_TAB_USER_WORKFLOW,
    DV_TAB_USER_CHAT,
    DV_TAB_USER_NOTE,
    DV_TAB_USER_PROFILE,
    DV_TAB_ROOT_CONTACTS,
} from '../../utils/TabNavigationConstants'
import { LINKED_OBJECT_TYPE_CONTACT } from '../../utils/LinkingHelper'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import { useDispatch, useSelector } from 'react-redux'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import { unwatch, watchUserData } from '../../utils/backends/firestore'
import UserProfileDv from '../SettingsView/Profile/UserProfileDv'
import DragModalsContainer from '../UIComponents/FloatModals/DragModalsContainer'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import NavigationService from '../../utils/NavigationService'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

const UserDetailedView = ({ navigation }) => {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const dispatch = useDispatch()
    const projectParam = navigation.getParam('project', undefined)
    const userParam = navigation.getParam('contact', undefined)
    const project = useSelector(state => state.loggedUserProjectsMap[projectParam.id])
    const projectId = project.id
    const projectIndex = project ? project.index : undefined
    const [isFullscreen, setFullscreen] = useState(false)
    const CustomView = selectedTab === DV_TAB_USER_CHAT || selectedTab === DV_TAB_USER_NOTE ? View : CustomScrollView

    const [user, setUser] = useState(userParam)

    const { overlay } = useCollapsibleSidebar()

    const updateUser = user => {
        if (!user) {
            if (loggedUser.isAnonymous) {
                SharedHelper.redirectToPrivateResource()
            } else {
                const { selectedTypeOfProject } = store.getState()

                NavigationService.navigate('Root')
                if (selectedTypeOfProject === PROJECT_TYPE_SHARED) {
                    dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
                } else {
                    dispatch([
                        resetFloatPopup(),
                        setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
                        resetLoadingData(),
                        setShowAccessDeniedPopup(true),
                    ])
                }
            }
        } else {
            setUser(user)
        }
    }

    useEffect(() => {
        const watcherKey = v4()
        watchUserData(userParam.uid, false, updateUser, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, userParam.uid])

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    const scrollViewRef = useRef()
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const navigationTabs = [
        DV_TAB_USER_PROFILE,
        DV_TAB_USER_PROPERTIES,
        DV_TAB_USER_WORKFLOW,
        DV_TAB_USER_STATISTICS,
        DV_TAB_USER_BACKLINKS,
        DV_TAB_USER_NOTE,
        DV_TAB_USER_CHAT,
        DV_TAB_USER_UPDATES,
    ]

    if (!accessGranted) {
        const indexBL = navigationTabs.indexOf(DV_TAB_USER_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
        const indexWF = navigationTabs.indexOf(DV_TAB_USER_WORKFLOW)
        navigationTabs.splice(indexWF, 1)
        const indexST = navigationTabs.indexOf(DV_TAB_USER_STATISTICS)
        navigationTabs.splice(indexST, 1)
        TasksHelper.changeSharedMode(accessGranted)
    }
    if (accessGranted && project.parentTemplateId) {
        const indexST = navigationTabs.indexOf(DV_TAB_USER_WORKFLOW)
        navigationTabs.splice(indexST, 1)
    }
    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_CONTACT,
        id: userParam.uid,
        idsField: 'linkedParentContactsIds',
    }

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    useEffect(() => {
        dispatch(setNavigationRoute('UserDetailedView'))
    }, [])

    useEffect(() => {
        const projectIndex = project ? project.index : undefined
        dispatch(switchProject(projectIndex))
    }, [selectedTab])

    const userIsLoggedUser = loggedUser.uid === userParam.uid
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    const hideCreateNoteSection = isGuide && !userIsLoggedUser

    return (
        <View style={localStyles.container}>
            <LoadingData />

            {((!loggedUser.isAnonymous && !mobile) || (loggedUser.isAnonymous && mobile && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}

            {!!user && (
                <View style={{ flex: 1 }}>
                    {!isMiddleScreen && accessGranted && (
                        <View style={[localStyles.backButton, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}>
                            <BackButton user={user} projectIndex={projectIndex} constant={URL_PEOPLE_DETAILS} />
                        </View>
                    )}

                    <CustomView
                        ref={scrollViewRef}
                        style={[
                            localStyles.scrollPanel,
                            mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
                            {(!isFullscreen || selectedTab !== DV_TAB_USER_NOTE) && (
                                <Header
                                    contact={user}
                                    project={project}
                                    isFullscreen={isFullscreen}
                                    setFullscreen={setFullscreen}
                                />
                            )}
                            <View style={{ flex: 1 }}>
                                {!isFullscreen && (
                                    <View style={mobile ? localStyles.navigationBar : undefined}>
                                        <NavigationBar taskDetail isSecondary tabs={navigationTabs} />
                                    </View>
                                )}
                                {(() => {
                                    switch (selectedTab) {
                                        case DV_TAB_USER_UPDATES:
                                            return (
                                                <RootViewFeedsUser
                                                    user={user}
                                                    userId={user.uid}
                                                    projectId={projectId}
                                                />
                                            )
                                        case DV_TAB_USER_WORKFLOW:
                                            return <WorkflowView user={user} projectIndex={projectIndex} />
                                        case DV_TAB_USER_PROPERTIES:
                                            return <UserProperties user={user} project={project} />
                                        case DV_TAB_USER_PROFILE:
                                            return (
                                                <UserProfileDv
                                                    projectIndex={project.index}
                                                    projectId={project.id}
                                                    user={user}
                                                />
                                            )
                                        case DV_TAB_USER_STATISTICS:
                                            return <StatisticsView projectId={project.id} userId={user.uid} />
                                        case DV_TAB_USER_BACKLINKS:
                                            return (
                                                <BacklinksView
                                                    project={project}
                                                    linkedParentObject={linkedParentObject}
                                                    externalStyle={{ marginHorizontal: 0 }}
                                                />
                                            )
                                        case DV_TAB_USER_CHAT:
                                            return (
                                                <ChatBoard
                                                    chat={{ id: user.uid, type: 'contacts' }}
                                                    projectId={project.id}
                                                    chatTitle={user.displayName}
                                                    assistantId={user.assistantId}
                                                    objectType={'users'}
                                                />
                                            )
                                        case DV_TAB_USER_NOTE:
                                            return (
                                                <NoteIntegration
                                                    project={project}
                                                    noteId={user.noteIdsByProject[projectId]}
                                                    objectId={user.uid}
                                                    objectName={user.displayName}
                                                    objectPrivacy={user.isPublicFor}
                                                    isFullscreen={isFullscreen}
                                                    setFullscreen={setFullscreen}
                                                    objectType="users"
                                                    object={user}
                                                    hideCreateNoteSection={hideCreateNoteSection}
                                                    creatorId={user.uid}
                                                />
                                            )
                                    }
                                })()}
                            </View>
                        </View>
                    </CustomView>
                    <DragModalsContainer />
                </View>
            )}

            {!mobile && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
        </View>
    )
}

export default UserDetailedView

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
