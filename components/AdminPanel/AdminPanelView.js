import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
    resetFloatPopup,
    setNavigationRoute,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setShowAccessDeniedPopup,
    storeCurrentUser,
} from '../../redux/actions'
import CustomScrollView from '../UIControls/CustomScrollView'
import {
    DV_TAB_ROOT_TASKS,
    DV_TAB_ADMIN_PANEL_USER,
    DV_TAB_ADMIN_PANEL_ASSISTANTS,
} from '../../utils/TabNavigationConstants'
import LoadingData from '../UIComponents/LoadingData'
import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import store from '../../redux/store'
import UserCustomizations from './UserCustomizations/UserCustomizations'
import SettingsHeader from './Header/SettingsHeader'
import BackButton from './Header/BackButton'
import Assistants from './Assistants/Assistants'
import { GLOBAL_PROJECT_ID } from './Assistants/assistantsHelper'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

export default function AdminPanelView({ navigation }) {
    const dispatch = useDispatch()
    const selectedTab = useSelector(state => state.selectedNavItem)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)

    const navigationTabs = [DV_TAB_ADMIN_PANEL_USER, DV_TAB_ADMIN_PANEL_ASSISTANTS]

    const { overlay } = useCollapsibleSidebar()

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        if (userIsAnonymous) {
            dispatch([resetFloatPopup(), setSelectedSidebarTab(DV_TAB_ROOT_TASKS), setShowAccessDeniedPopup(true)])
            navigation.navigate('Root')
        } else {
            const tab = navigationTabs.includes(selectedTab) ? selectedTab : DV_TAB_ADMIN_PANEL_USER
            dispatch([setSelectedNavItem(tab)])
        }
    }, [])

    return (
        <View style={localStyles.container}>
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
                    style={[
                        localStyles.scrollPanel,
                        mobile ? localStyles.scrollPanelMobile : isMiddleScreen && localStyles.scrollPanelTablet,
                        overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                    ]}
                >
                    <View style={localStyles.scrollContainer}>
                        <SettingsHeader />
                        <View style={mobile ? localStyles.navigationBar : undefined}>
                            <NavigationBar taskDetail isSecondary tabs={navigationTabs} />
                        </View>
                        {(() => {
                            switch (selectedTab) {
                                case DV_TAB_ADMIN_PANEL_USER:
                                    return <UserCustomizations />
                                case DV_TAB_ADMIN_PANEL_ASSISTANTS:
                                    return <Assistants />
                            }
                        })()}
                    </View>
                </CustomScrollView>
            </View>
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
