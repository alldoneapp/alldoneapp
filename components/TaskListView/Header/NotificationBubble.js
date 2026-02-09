import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../../SidebarMenu/Themes'
import styles, { colors } from '../../styles/global'
import store from '../../../redux/store'
import {
    hideFloatPopup,
    hideWebSideBar,
    setChatsActiveTab,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    storeCurrentUser,
    switchProject,
    switchShortcutProject,
} from '../../../redux/actions'
import { DV_TAB_ROOT_CHATS } from '../../../utils/TabNavigationConstants'
import { ALL_TAB, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function NotificationBubble({ amount, isFollowedNotification, containerStyle, projectId }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)

    const backgroundColor = isFollowedNotification ? colors.UtilityRed200 : colors.Gray500
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemIcon')

    const navigateToChats = () => {
        const { smallScreenNavigation, loggedUser } = store.getState()

        const tab = isFollowedNotification ? FOLLOWED_TAB : ALL_TAB
        const projectIndex = ProjectHelper.getProjectById(projectId)?.index
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)

        const actionsToDispatch = [
            setChatsActiveTab(tab),
            setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
            hideFloatPopup(),
            storeCurrentUser(loggedUser),
            setSelectedTypeOfProject(projectType),
            switchProject(projectIndex),
            switchShortcutProject(projectIndex),
        ]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        dispatch(actionsToDispatch)
    }

    return (
        <TouchableOpacity
            onPress={navigateToChats}
            style={[localStyles.container, theme.indicator, { backgroundColor }, containerStyle]}
        >
            <Text style={[localStyles.text, theme.indicatorText]}>{amount}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 18,
        height: 18,
        borderRadius: 100,
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        ...styles.body3,
    },
})
