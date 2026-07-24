import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import Header from './Header/Header'
import BackButton from './Header/BackButton'
import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import {
    navigateToAllProjectsTasks,
    resetFloatPopup,
    setNavigationRoute,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
} from '../../redux/actions'
import CustomScrollView from '../UIControls/CustomScrollView'
import {
    DV_TAB_ASSISTANT_BACKLINKS,
    DV_TAB_ASSISTANT_CHAT,
    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
    DV_TAB_ASSISTANT_NOTE,
    DV_TAB_ASSISTANT_UPDATES,
    DV_TAB_ROOT_TASKS,
} from '../../utils/TabNavigationConstants'
import { watchAssistant } from '../../utils/backends/Assistants/assistantsFirestore'
import { getProjectData, unwatch } from '../../utils/backends/firestore'
import AssistantCustomizations from './Customizations/AssistantCustomizations'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import store from '../../redux/store'
import LoadingData from '../UIComponents/LoadingData'
import BacklinksView from '../BacklinksView/BacklinksView'
import { LINKED_OBJECT_TYPE_ASSISTANT } from '../../utils/LinkingHelper'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import RootViewFeedsAssistant from '../Feeds/RootViewFeedsAssistant'
import { GLOBAL_PROJECT_ID } from '../AdminPanel/Assistants/assistantsHelper'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

export default function AssistantDetailedView({ navigation }) {
    const assistantId = navigation.getParam('assistantId', undefined)
    const projectId = navigation.getParam('projectId', undefined)

    const dispatch = useDispatch()
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const administratorUserId = useSelector(state => state.administratorUser.uid)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const [assistant, setAssistant] = useState(null)
    const [projectOriginId, setProjectOriginId] = useState('')
    const [isFullscreen, setFullscreen] = useState(false)

    const isGlobalAsisstant = projectId !== projectOriginId
    const isInGlobalProject = projectId === GLOBAL_PROJECT_ID

    const navigationTabs = [DV_TAB_ASSISTANT_CUSTOMIZATIONS]
    if (!isInGlobalProject) navigationTabs.push(DV_TAB_ASSISTANT_BACKLINKS)
    if (!isInGlobalProject && !isGlobalAsisstant) navigationTabs.push(DV_TAB_ASSISTANT_NOTE)
    if (!isInGlobalProject && !isGlobalAsisstant) navigationTabs.push(DV_TAB_ASSISTANT_CHAT)
    if (!isInGlobalProject && !isGlobalAsisstant) navigationTabs.push(DV_TAB_ASSISTANT_UPDATES)

    const accessGranted = !isInGlobalProject || (!loggedUser.isAnonymous && loggedUser.uid === administratorUserId)

    const { overlay } = useCollapsibleSidebar()

    const updateAssistant = assistantUpdated => {
        if (assistantUpdated) {
            setAssistant(assistantUpdated)
        } else {
            const { selectedTypeOfProject } = store.getState()

            navigation.navigate('Root')
            if (selectedTypeOfProject === PROJECT_TYPE_SHARED) {
                dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            } else {
                dispatch([resetFloatPopup(), setShowAccessDeniedPopup(true), navigateToAllProjectsTasks()])
            }
        }
    }

    const loadProjectAnddAssistantData = async watcherKey => {
        let projectOriginId = projectId
        if (!isInGlobalProject) {
            const project = await getProjectData(projectId)
            if (project.globalAssistantIds.includes(assistantId)) projectOriginId = GLOBAL_PROJECT_ID
        }
        watchAssistant(projectOriginId, assistantId, watcherKey, updateAssistant)
        setProjectOriginId(projectOriginId)
    }

    useEffect(() => {
        if (accessGranted) {
            const watcherKey = v4()
            loadProjectAnddAssistantData(watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        }
    }, [accessGranted, assistantId, projectId])

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        if (accessGranted && projectOriginId) {
            const tab = navigationTabs.includes(selectedNavItem) ? selectedNavItem : DV_TAB_ASSISTANT_CUSTOMIZATIONS
            dispatch(setSelectedNavItem(tab))
        }
    }, [projectOriginId, accessGranted, selectedNavItem])

    useEffect(() => {
        if (accessGranted) {
            dispatch(setNavigationRoute('AssistantDetailedView'))
        } else {
            navigation.navigate('Root')
            dispatch([resetFloatPopup(), setSelectedSidebarTab(DV_TAB_ROOT_TASKS), setShowAccessDeniedPopup(true)])
        }
    }, [accessGranted])

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_ASSISTANT,
        id: assistantId,
        idsField: 'linkedParentAssistantIds',
    }

    //check here
    const globalProject = { id: GLOBAL_PROJECT_ID }
    const project = isInGlobalProject ? globalProject : ProjectHelper.getProjectById(projectId)

    const CustomView =
        selectedNavItem === DV_TAB_ASSISTANT_NOTE || selectedNavItem === DV_TAB_ASSISTANT_CHAT ? View : CustomScrollView

    return (
        <View style={localStyles.container}>
            {!smallScreenNavigation ? <CustomSideMenu navigation={navigation} isWeb /> : null}
            {!!assistant && !!projectOriginId && (
                <View style={{ flex: 1 }}>
                    {!isMiddleScreen && <BackButton assistant={assistant} />}

                    <CustomView
                        style={[
                            localStyles.scrollPanel,
                            smallScreenNavigation
                                ? localStyles.scrollPanelMobile
                                : isMiddleScreen && localStyles.scrollPanelTablet,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        <View style={{ backgroundColor: 'white', flex: 1 }}>
                            {(!isFullscreen || selectedNavItem !== DV_TAB_ASSISTANT_NOTE) && (
                                <Header
                                    isGlobalAsisstant={isGlobalAsisstant}
                                    projectId={projectOriginId}
                                    projectDetailedId={projectId}
                                    assistant={assistant}
                                    navigation={navigation}
                                    isFullscreen={isFullscreen}
                                    setFullscreen={setFullscreen}
                                />
                            )}
                            <View style={{ flex: 1 }}>
                                <View style={smallScreenNavigation ? localStyles.navigationBar : undefined}>
                                    <NavigationBar
                                        taskDetail
                                        isSecondary
                                        tabs={navigationTabs}
                                        style={{ height: 56 }}
                                    />
                                </View>

                                {(() => {
                                    switch (selectedNavItem) {
                                        case DV_TAB_ASSISTANT_CUSTOMIZATIONS:
                                            return (
                                                <AssistantCustomizations
                                                    projectDetailedId={projectId}
                                                    projectId={projectOriginId}
                                                    assistant={assistant}
                                                    isGlobalAsisstant={isGlobalAsisstant}
                                                    isInGlobalProject={isInGlobalProject}
                                                    isAdmin={loggedUser.uid === administratorUserId}
                                                />
                                            )
                                        case DV_TAB_ASSISTANT_BACKLINKS:
                                            return (
                                                <BacklinksView
                                                    project={project}
                                                    linkedParentObject={linkedParentObject}
                                                    externalStyle={{ marginHorizontal: 0 }}
                                                />
                                            )
                                        case DV_TAB_ASSISTANT_NOTE:
                                            return (
                                                <NoteIntegration
                                                    project={project}
                                                    noteId={assistant.noteIdsByProject[projectId]}
                                                    objectId={assistant.uid}
                                                    objectName={assistant.displayName}
                                                    objectPrivacy={[FEED_PUBLIC_FOR_ALL]}
                                                    isFullscreen={isFullscreen}
                                                    setFullscreen={setFullscreen}
                                                    objectType="assistants"
                                                    object={assistant}
                                                    creatorId={assistant.creatorId}
                                                    isInGlobalProject={isInGlobalProject}
                                                />
                                            )
                                        case DV_TAB_ASSISTANT_CHAT:
                                            return (
                                                <ChatBoard
                                                    chat={{ id: assistant.uid, type: 'assistants' }}
                                                    projectId={project.id}
                                                    chatTitle={assistant.displayName}
                                                    assistantId={assistant.uid}
                                                    objectType={'assistants'}
                                                />
                                            )
                                        case DV_TAB_ASSISTANT_UPDATES:
                                            return (
                                                <RootViewFeedsAssistant projectId={project.id} assistant={assistant} />
                                            )
                                    }
                                })()}
                            </View>
                        </View>
                    </CustomView>
                </View>
            )}
            <LoadingData />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
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
