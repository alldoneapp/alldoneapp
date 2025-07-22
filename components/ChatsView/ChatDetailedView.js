import React, { useEffect, useRef, useState } from 'react'
import v4 from 'uuid/v4'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import LoadingData from '../UIComponents/LoadingData'
import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import Header from './ChatDV/Header'
import LoadingNoteData from '../UIComponents/LoadingNoteData'
import NavigationBar from '../NavigationBar/NavigationBar'
import { DV_TAB_CHAT_BOARD, DV_TAB_CHAT_NOTE, DV_TAB_CHAT_PROPERTIES } from '../../utils/TabNavigationConstants'
import ChatBoard from './ChatDV/ChatBoard'
import CustomScrollView from '../UIControls/CustomScrollView'
import PropertiesView from './ChatDV/Properties/PropertiesView'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import SharedHelper from '../../utils/SharedHelper'
import {
    navigateToAllProjectsTasks,
    resetFloatPopup,
    setNavigationRoute,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
} from '../../redux/actions'
import store from '../../redux/store'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import NavigationService from '../../utils/NavigationService'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import usePrivateProject from '../../hooks/usePrivateProject'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'
import { watchChat } from '../../utils/backends/Chats/chatsFirestore'
import { unwatch } from '../../utils/backends/firestore'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

const ChatDetailedView = ({ navigation }) => {
    const dispatch = useDispatch()
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const loggedUser = useSelector(state => state.loggedUser)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)

    const navigationTabs = [DV_TAB_CHAT_BOARD, DV_TAB_CHAT_PROPERTIES, DV_TAB_CHAT_NOTE]
    const projectId = navigation.getParam('projectId', {})
    const [chat, setChat] = useState(navigation.getParam('chat', {}))
    const [isFullscreen, setFullscreen] = useState(false)
    const CustomView = selectedTab === DV_TAB_CHAT_BOARD || selectedTab === DV_TAB_CHAT_NOTE ? View : CustomScrollView
    const scrollRef = useRef()
    usePrivateProject(projectId)

    const { overlay } = useCollapsibleSidebar()

    const redirectOut = showAccessDeniedModal => {
        if (loggedUser.isAnonymous) {
            SharedHelper.redirectToPrivateResource()
        } else {
            const { selectedTypeOfProject } = store.getState()
            NavigationService.navigate('Root')
            dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            if (selectedTypeOfProject !== PROJECT_TYPE_SHARED && showAccessDeniedModal)
                dispatch(setShowAccessDeniedPopup(true))
        }
    }

    const checkIfIsPrivateChat = isPublicFor => {
        const isPrivateForUser =
            !isPublicFor.includes(FEED_PUBLIC_FOR_ALL) &&
            (loggedUser.isAnonymous || !isPublicFor.includes(loggedUser.uid))
        return isPrivateForUser
    }

    const updateChat = chatUpdated => {
        if (chatUpdated) {
            const isPrivateForUser = checkIfIsPrivateChat(chatUpdated.isPublicFor)
            isPrivateForUser ? redirectOut(true) : setChat(chatUpdated)
        } else {
            redirectOut(false)
        }
    }

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        dispatch(setNavigationRoute('ChatDetailedView'))
    }, [])

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    useEffect(() => {
        if (chat) {
            const isPrivateForUser = checkIfIsPrivateChat(chat.isPublicFor)
            if (isPrivateForUser) redirectOut(true)
        }
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        watchChat(projectId, chat.id, watcherKey, updateChat)
        return () => {
            unwatch(watcherKey)
        }
    }, [])

    return (
        <View style={localStyles.container}>
            <LoadingData />
            <LoadingNoteData />

            {((!loggedUser.isAnonymous && !mobile) || (loggedUser.isAnonymous && mobile && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}
            <CustomView
                ref={scrollRef}
                style={[
                    localStyles.scrollPanel,
                    mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                    overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                ]}
            >
                <View style={{ flexDirection: 'column', flex: 1 }}>
                    <Header
                        navigation={navigation}
                        projectId={projectId}
                        chat={chat}
                        isFullscreen={isFullscreen}
                        setFullscreen={setFullscreen}
                    />

                    <View style={{ flex: 1 }}>
                        {!isFullscreen && (
                            <View style={mobile ? localStyles.navigationBar : undefined}>
                                <NavigationBar isSecondary tabs={navigationTabs} />
                            </View>
                        )}

                        {(() => {
                            switch (selectedTab) {
                                case DV_TAB_CHAT_BOARD:
                                    return (
                                        <ChatBoard
                                            chat={chat}
                                            projectId={projectId}
                                            chatTitle={chat?.title}
                                            members={chat?.usersFollowing}
                                            assistantId={chat.assistantId}
                                            objectType={'chats'}
                                        />
                                    )
                                case DV_TAB_CHAT_PROPERTIES:
                                    return <PropertiesView chat={chat} projectId={projectId} />
                                case DV_TAB_CHAT_NOTE:
                                    return (
                                        <NoteIntegration
                                            project={{ id: projectId }}
                                            noteId={chat?.noteId}
                                            objectId={chat.id}
                                            objectName={chat.title}
                                            objectPrivacy={chat.isPublicFor}
                                            isFullscreen={isFullscreen}
                                            setFullscreen={setFullscreen}
                                            objectType="topics"
                                            object={chat}
                                            creatorId={chat.creatorId}
                                        />
                                    )
                            }
                        })()}
                    </View>
                </View>
            </CustomView>
            {!mobile && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
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

export default ChatDetailedView
