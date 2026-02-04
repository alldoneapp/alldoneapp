import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import Header from './Header/Header'
import BackButton from '../UserDetailedView/Header/BackButton'
import ContactProperties from './ContactProperties/ContactProperties'
import {
    navigateToAllProjectsTasks,
    resetFloatPopup,
    resetLoadingData,
    setNavigationRoute,
    setSelectedSidebarTab,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
} from '../../redux/actions'
import store from '../../redux/store'
import RootViewFeedsContact from '../Feeds/RootViewFeedsContact'
import { URL_CONTACT_DETAILS } from '../../URLSystem/Contacts/URLsContacts'
import CustomScrollView from '../UIControls/CustomScrollView'
import BacklinksView from '../BacklinksView/BacklinksView'
import {
    DV_TAB_CONTACT_BACKLINKS,
    DV_TAB_CONTACT_CHAT,
    DV_TAB_CONTACT_NOTE,
    DV_TAB_CONTACT_PROPERTIES,
    DV_TAB_CONTACT_UPDATES,
    DV_TAB_ROOT_CONTACTS,
} from '../../utils/TabNavigationConstants'
import { LINKED_OBJECT_TYPE_CONTACT } from '../../utils/LinkingHelper'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import { useDispatch, useSelector } from 'react-redux'
import ContactsHelper from '../ContactsView/Utils/ContactsHelper'
import NavigationService from '../../utils/NavigationService'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import usePrivateProject from '../../hooks/usePrivateProject'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'
import { watchContactData } from '../../utils/backends/Contacts/contactsFirestore'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import { unwatch } from '../../utils/backends/firestore'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

const ContactDetailedView = ({ navigation }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const [isFullscreen, setFullscreen] = useState(false)
    const project = navigation.getParam('project', undefined)
    const contactParam = navigation.getParam('contact', undefined)
    const [contact, setContact] = useState(contactParam)
    const projectId = project.id
    const projectIndex = project.index
    const CustomView =
        selectedTab === DV_TAB_CONTACT_CHAT || selectedTab === DV_TAB_CONTACT_NOTE ? View : CustomScrollView

    const dispatch = useDispatch()
    usePrivateProject(projectId)
    const navigationTabs = [
        DV_TAB_CONTACT_PROPERTIES,
        DV_TAB_CONTACT_BACKLINKS,
        DV_TAB_CONTACT_NOTE,
        DV_TAB_CONTACT_CHAT,
        DV_TAB_CONTACT_UPDATES,
    ]

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_CONTACT,
        id: contactParam.uid,
        idsField: 'linkedParentContactsIds',
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const { overlay } = useCollapsibleSidebar()

    if (!accessGranted) {
        const indexBL = navigationTabs.indexOf(DV_TAB_CONTACT_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
        TasksHelper.changeSharedMode(accessGranted)
    }

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    useEffect(() => {
        dispatch(setNavigationRoute('ContactDetailedView'))
    }, [])

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    const updateContact = contact => {
        if (!contact || ContactsHelper.isPrivateContact(contact)) {
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
            setContact(contact)
        }
    }

    useEffect(() => {
        const watcherKey = v4()
        watchContactData(projectId, contactParam.uid, updateContact, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, contactParam.uid])

    const loggedUserIsCreator = contact && loggedUser.uid === contact.recorderUserId
    const loggedUserCanUpdateObject =
        loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    const hideCreateNoteSection = isGuide && !loggedUserIsCreator

    return (
        <View style={localStyles.container}>
            {((!loggedUser.isAnonymous && !mobile) || (loggedUser.isAnonymous && mobile && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}

            {!!contact && (
                <View style={{ flex: 1 }}>
                    {!isMiddleScreen && accessGranted && (
                        <View style={[localStyles.backButton, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}>
                            <BackButton user={contact} projectIndex={projectIndex} constant={URL_CONTACT_DETAILS} />
                        </View>
                    )}

                    <CustomView
                        style={[
                            localStyles.scrollPanel,
                            mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
                            {(!isFullscreen || selectedTab !== DV_TAB_CONTACT_NOTE) && (
                                <Header
                                    contact={contact}
                                    disabled={!loggedUserCanUpdateObject}
                                    isFullscreen={isFullscreen}
                                    setFullscreen={setFullscreen}
                                    projectId={projectId}
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
                                        case DV_TAB_CONTACT_PROPERTIES:
                                            return (
                                                <ContactProperties
                                                    projectId={project.id}
                                                    project={project}
                                                    user={contact}
                                                    projectIndex={projectIndex}
                                                />
                                            )
                                        case DV_TAB_CONTACT_UPDATES:
                                            return (
                                                <RootViewFeedsContact
                                                    contact={contact}
                                                    contactId={contact.uid}
                                                    projectId={projectId}
                                                />
                                            )
                                        case DV_TAB_CONTACT_BACKLINKS:
                                            return (
                                                <BacklinksView
                                                    project={project}
                                                    linkedParentObject={linkedParentObject}
                                                    externalStyle={{ marginHorizontal: 0 }}
                                                />
                                            )
                                        case DV_TAB_CONTACT_CHAT:
                                            return (
                                                <ChatBoard
                                                    chat={{ id: contact.uid, type: 'contacts' }}
                                                    projectId={project.id}
                                                    chatTitle={contact.displayName}
                                                    assistantId={contact.assistantId}
                                                    objectType={'contacts'}
                                                />
                                            )
                                        case DV_TAB_CONTACT_NOTE:
                                            return (
                                                <NoteIntegration
                                                    project={project}
                                                    noteId={contact.noteId}
                                                    objectId={contact.uid}
                                                    objectName={contact.displayName}
                                                    objectPrivacy={contact.isPublicFor}
                                                    isFullscreen={isFullscreen}
                                                    setFullscreen={setFullscreen}
                                                    objectType="contacts"
                                                    hideCreateNoteSection={hideCreateNoteSection}
                                                    object={contact}
                                                    creatorId={contact.recorderUserId}
                                                />
                                            )
                                    }
                                })()}
                            </View>
                        </View>
                    </CustomView>
                </View>
            )}

            {!mobile && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
        </View>
    )
}

export default ContactDetailedView

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
