import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setGoalsActiveTab,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
    setSelectedNavItem,
} from '../../../redux/actions'
import { GOALS_OPEN_TAB_INDEX } from '../../GoalsView/GoalsHelper'
import NavigationService from '../../../utils/NavigationService'
import {
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_TASKS,
    DV_TAB_USER_PROFILE,
    ROOT_ROUTES,
} from '../../../utils/TabNavigationConstants'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import UserData from './Common/UserData'
import Indicator from './Common/Indicator'
import Amount from './Common/Amount'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function UserItem({
    user,
    projectType,
    projectId,
    projectColor,
    projectIndex,
    isShared,
    shortcut,
    navItem,
    showIndicator,
}) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const shownFloatPopup = useSelector(state => state.shownFloatPopup)
    const shortcutCurrentUserUid = useSelector(state => state.shortcutCurrentUserUid)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)

    const showShortcut = shortcut != null && showShortcuts && !shownFloatPopup && !exitsOpenModals()
    const highlight = currentUserId === user.uid
    const showAmount = navItem === DV_TAB_ROOT_TASKS
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    const hideSideBar = () => {
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    const getLastVisitedBoardProerty = () => {
        if (navItem === DV_TAB_ROOT_GOALS) return 'lastVisitBoardInGoals'
        if (navItem === DV_TAB_ROOT_TASKS) return 'lastVisitBoard'
    }

    const onPress = e => {
        e?.preventDefault()
        const { route, selectedNavItem } = store.getState()

        if (currentUserId === user.uid && (route === DV_TAB_ROOT_TASKS || route === DV_TAB_ROOT_GOALS)) {
            const project = ProjectHelper.getProjectById(projectId)
            NavigationService.navigate('UserDetailedView', {
                contact: user,
                project,
            })
            dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
            return
        }

        if (selectedNavItem !== navItem) {
            dispatch(setSelectedSidebarTab(navItem))
        }

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')

        ContactsHelper.setUserLastVisitedBoardDate(projectId, user, getLastVisitedBoardProerty())

        let dispatches = [
            setSelectedSidebarTab(navItem), // Comment this to NOT go to Tasks when change user in sidebar
            storeCurrentUser(user),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
        ]

        if (navItem === DV_TAB_ROOT_TASKS) {
            dispatches.push(setTaskViewToggleIndex(0))
            dispatches.push(setTaskViewToggleSection('Open'))
        } else if (navItem === DV_TAB_ROOT_GOALS) {
            dispatches.push(setGoalsActiveTab(GOALS_OPEN_TAB_INDEX))
        }

        dispatch(dispatches)
        hideSideBar()
    }

    useEffect(() => {
        if (shortcutCurrentUserUid === user.uid) onPress()
    }, [shortcutCurrentUserUid])

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isShared}
            accessibilityLabel={'sidebar-user-item'}
            nativeID={`sidebar-user@${user.uid}`}
        >
            {/*{showShortcut && <ItemShortcut shortcut={shortcut} />}*/}
            <View
                style={[
                    localStyles.container,
                    highlight ? theme.containerActive(projectColor) : theme.container(projectColor),
                    !expanded && localStyles.containerCollapsed,
                    !highlight && hover && theme.containerActive(projectColor),
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                {showIndicator && !highlight && <Indicator projectColor={projectColor} />}
                <UserData user={user} projectId={projectId} projectIndex={projectIndex} />
                {showAmount && !isShared && (expanded || highlight) && (
                    <Amount userId={user.uid} projectColor={projectColor} projectId={projectId} />
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row',
        height: 48,
        paddingLeft: 26,
    },
    containerCollapsed: {
        paddingLeft: 18,
    },
})
