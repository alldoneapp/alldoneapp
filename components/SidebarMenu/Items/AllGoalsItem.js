import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setGoalsActiveTab,
    storeCurrentShortcutUser,
    storeCurrentUser,
} from '../../../redux/actions'
import { GOALS_OPEN_TAB_INDEX } from '../../GoalsView/GoalsHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_ROOT_GOALS, ROOT_ROUTES } from '../../../utils/TabNavigationConstants'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import AllGoalsData from './AllGoalsData'
import { ALL_GOALS_ID } from '../../AllSections/allSectionHelper'
import Indicator from './Common/Indicator'

export default function AllGoalsItem({ section, projectType, projectColor, isShared }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const shortcutCurrentUserUid = useSelector(state => state.shortcutCurrentUserUid)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)

    const highlight = currentUserId === ALL_GOALS_ID
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    useEffect(() => {
        if (shortcutCurrentUserUid === ALL_GOALS_ID) onPress()
    }, [shortcutCurrentUserUid])

    const onPress = e => {
        e?.preventDefault()
        const { route, selectedNavItem } = store.getState()
        if (selectedNavItem !== DV_TAB_ROOT_GOALS) dispatch(setSelectedSidebarTab(DV_TAB_ROOT_GOALS))

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')

        dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            storeCurrentUser(section),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
            setGoalsActiveTab(GOALS_OPEN_TAB_INDEX),
        ])
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isShared}
            accessibilityLabel={'sidebar-user-item'}
            nativeID={`sidebar-user@${ALL_GOALS_ID}`}
        >
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
                {!highlight && <Indicator projectColor={projectColor} />}
                <AllGoalsData sectionId={section.uid} sectionName={section.displayName} />
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
