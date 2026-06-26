import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import SettingsHeader from './Header/SettingsHeader'
import BackButton from './Header/BackButton'
import {
    resetFloatPopup,
    setNavigationRoute,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setShowAccessDeniedPopup,
    storeCurrentUser,
} from '../../redux/actions'
import store from '../../redux/store'
import Customizations from './Customizations/Customizations'
import ProjectsSettings from './ProjectsSettings/ProjectsSettings'
import ProjectsInvitations from './Invitations/ProjectsInvitations'
import ProjectInvitationPopup from '../UIComponents/ProjectInvitation/ProjectInvitationPopup'
import UserStatistics from './Statistics/UserStatistics'
import UserHappiness from './Happiness/UserHappiness'
import UserOKRs from './OKRs/UserOKRs'
import CustomScrollView from '../UIControls/CustomScrollView'
import ShortcutsSection from './Shortcuts/ShortcutsSection'
import {
    DV_TAB_ROOT_TASKS,
    DV_TAB_SETTINGS_INVITATIONS,
    DV_TAB_SETTINGS_PREMIUM,
    DV_TAB_SETTINGS_PROJECTS,
    DV_TAB_SETTINGS_SHORTCUTS,
    DV_TAB_SETTINGS_STATISTICS,
    DV_TAB_SETTINGS_CUSTOMIZATIONS,
    DV_TAB_SETTINGS_PROFILE,
    DV_TAB_SETTINGS_EXPORT,
    DV_TAB_SETTINGS_HAPPINESS,
    DV_TAB_SETTINGS_OKRS,
    DV_TAB_SETTINGS_MCP,
} from '../../utils/TabNavigationConstants'
import StripePremiumTab from '../Premium/PremiumTab/StripePremiumTab'
import ExportTab from './Export/ExportTab'
import MCPSettings from './MCP/MCPSettings'
import { useDispatch, useSelector } from 'react-redux'
import LoadingData from '../UIComponents/LoadingData'
import UserProfileSettings from './Profile/UserProfileSettings'
import DragModalsContainer from '../UIComponents/FloatModals/DragModalsContainer'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

const SettingsView = ({ navigation }) => {
    const dispatch = useDispatch()
    const scrollRef = useRef(null)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const settingsScrollToTopToken = useSelector(state => state.settingsScrollToTopToken)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showProjectInvitationPopup = useSelector(state => state.showProjectInvitationPopup.visible)
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const amountProjectInvitations = useSelector(state => state.loggedUser.invitedProjectIds.length)

    const { overlay } = useCollapsibleSidebar()

    const navigationTabs = [
        DV_TAB_SETTINGS_PROFILE,
        DV_TAB_SETTINGS_CUSTOMIZATIONS,
        DV_TAB_SETTINGS_PROJECTS,
        DV_TAB_SETTINGS_INVITATIONS,
        DV_TAB_SETTINGS_STATISTICS,
        DV_TAB_SETTINGS_HAPPINESS,
        DV_TAB_SETTINGS_OKRS,
        DV_TAB_SETTINGS_SHORTCUTS,
        DV_TAB_SETTINGS_EXPORT,
        DV_TAB_SETTINGS_MCP,
        DV_TAB_SETTINGS_PREMIUM,
    ]

    useEffect(() => {
        if (userIsAnonymous) {
            dispatch([resetFloatPopup(), setSelectedSidebarTab(DV_TAB_ROOT_TASKS), setShowAccessDeniedPopup(true)])
            navigation.navigate('Root')
        } else {
            const tab = navigationTabs.includes(selectedTab) ? selectedTab : DV_TAB_SETTINGS_PROFILE
            dispatch([setSelectedNavItem(tab)])
        }
    }, [])

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        if (settingsScrollToTopToken && selectedTab === DV_TAB_SETTINGS_PROFILE) {
            scrollRef.current?.scrollTo({ y: 0, animated: false })
        }
    }, [settingsScrollToTopToken, selectedTab])

    return (
        <View style={localStyles.container}>
            {showProjectInvitationPopup && <ProjectInvitationPopup navigation={navigation} />}
            {!mobile ? <CustomSideMenu navigation={navigation} isWeb /> : null}

            <View style={{ flex: 1 }}>
                {!isMiddleScreen && (
                    <View
                        style={[
                            localStyles.backButtonContainer,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        <BackButton />
                    </View>
                )}

                <CustomScrollView
                    ref={scrollRef}
                    style={[
                        localStyles.scrollPanel,
                        mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                        overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                    ]}
                >
                    <View style={localStyles.scrollContainer}>
                        <SettingsHeader />
                        <View style={mobile ? localStyles.navigationBar : undefined}>
                            <NavigationBar
                                taskDetail
                                isSecondary
                                tabs={navigationTabs}
                                invitationsAmount={amountProjectInvitations}
                            />
                        </View>
                        {(() => {
                            switch (selectedTab) {
                                case DV_TAB_SETTINGS_PROFILE:
                                    return <UserProfileSettings />
                                case DV_TAB_SETTINGS_CUSTOMIZATIONS:
                                    return <Customizations />
                                case DV_TAB_SETTINGS_PROJECTS:
                                    return <ProjectsSettings />
                                case DV_TAB_SETTINGS_INVITATIONS:
                                    return <ProjectsInvitations />
                                case DV_TAB_SETTINGS_STATISTICS:
                                    return <UserStatistics />
                                case DV_TAB_SETTINGS_HAPPINESS:
                                    return <UserHappiness />
                                case DV_TAB_SETTINGS_OKRS:
                                    return <UserOKRs />
                                case DV_TAB_SETTINGS_SHORTCUTS:
                                    return <ShortcutsSection />
                                case DV_TAB_SETTINGS_PREMIUM:
                                    return <StripePremiumTab />
                                case DV_TAB_SETTINGS_EXPORT:
                                    return <ExportTab />
                                case DV_TAB_SETTINGS_MCP:
                                    return <MCPSettings />
                            }
                        })()}
                    </View>
                </CustomScrollView>
                <DragModalsContainer />
            </View>
            <LoadingData />
        </View>
    )
}

export default SettingsView

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
    backButtonContainer: {
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
    scrollContainer: {
        flexDirection: 'column',
        backgroundColor: 'white',
        flex: 1,
    },
    navigationBar: {
        marginHorizontal: -16,
    },
})
