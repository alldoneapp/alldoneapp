import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../Icon'
import {
    hideFloatPopup,
    navigateToAllProjectsTasks,
    navigateToUpdates,
    setReloadGlobalFeeds,
    setSelectedSidebarTab,
    showGlobalSearchPopup,
    switchProject,
} from '../../redux/actions'
import { ROOT_ROUTES, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import Shortcut from '../UIControls/Shortcut'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { ALL_PROJECTS_INDEX, checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import NavigationService from '../../utils/NavigationService'

export default function NotificationArea() {
    const dispatch = useDispatch()
    const showShortcuts = useSelector(state => state.showShortcuts)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const followedFeedsAmount = useSelector(state => state.followedFeedsAmount)
    const allFeedsAmount = useSelector(state => state.allFeedsAmount)
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)

    const theme = getTheme(Themes, themeName, 'TopBar.NotificationArea')

    const onPressHome = e => {
        e?.preventDefault()
        dismissAllPopups()
        dispatch([
            switchProject(ALL_PROJECTS_INDEX),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            navigateToAllProjectsTasks({ taskViewToggleSection: 'Open', taskViewToggleIndex: 0 }),
        ])
        NavigationService.navigate('Root')
    }

    const onPressSearch = e => {
        e?.preventDefault()
        dispatch([hideFloatPopup(), showGlobalSearchPopup(false)])
        dismissAllPopups()
    }

    const onPressUpdates = e => {
        const { selectedProjectIndex, route } = store.getState()

        dismissAllPopups(true, true, true)

        dispatch([
            hideFloatPopup(),
            setReloadGlobalFeeds(true),
            navigateToUpdates({
                selectedProjectIndex: checkIfSelectedProject(selectedProjectIndex)
                    ? selectedProjectIndex
                    : ALL_PROJECTS_INDEX,
            }),
        ])

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
    }

    const feedAmount = followedFeedsAmount === 0 ? allFeedsAmount : followedFeedsAmount
    const activeFeedTab = followedFeedsAmount === 0 && allFeedsAmount > 0 ? ALL_TAB : FOLLOWED_TAB

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={[localStyles.cog, { marginLeft: 0 }]} onPress={onPressHome} accessible={false}>
                <Icon size={24} name={'home'} color={theme.iconColor} />
            </TouchableOpacity>

            <TouchableOpacity style={localStyles.cog} onPress={onPressSearch} accessible={false}>
                <Icon size={24} name={'search'} color={theme.iconColor} />

                {showShortcuts && (
                    <View style={localStyles.shortcutSearch}>
                        <Shortcut text={'F'} />
                    </View>
                )}
            </TouchableOpacity>

            <TouchableOpacity style={localStyles.updates} onPress={onPressUpdates} accessible={false}>
                <Icon size={24} name={'bell'} color={theme.iconColor} />

                {feedAmount > 0 && (
                    <View style={localStyles.updatesBadge}>
                        <AmountTag feedAmount={feedAmount} isFollowedButton={activeFeedTab === FOLLOWED_TAB} />
                    </View>
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    notificationArea: {
        width: 132,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    container: {
        width: 160,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    cog: {
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 16,
        height: 28,
        width: 28,
    },
    updates: {
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 16,
        height: 28,
        width: 28,
    },
    updatesBadge: {
        position: 'absolute',
        top: -3,
        left: 14,
    },
    shortcutSearch: {
        position: 'absolute',
        top: -8,
        right: -8,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
