import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import {
    hideFloatPopup,
    navigateToAllProjectsTasks,
    navigateToUpdates,
    setReloadGlobalFeeds,
    setSearchText,
    setSelectedSidebarTab,
    showGlobalSearchPopup,
    switchProject,
} from '../../../redux/actions'
import { ROOT_ROUTES, DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import Icon from '../../Icon'
import AmountTag from '../../Feeds/FollowSwitchableTag/AmountTag'
import store from '../../../redux/store'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import { ALL_TAB, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import { ALL_PROJECTS_INDEX, checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../utils/NavigationService'

export default function MobileNotificationArea({ expandSecondaryBar }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const followedFeedsAmount = useSelector(state => state.followedFeedsAmount)
    const allFeedsAmount = useSelector(state => state.allFeedsAmount)

    const theme = getTheme(Themes, themeName, 'TopBarMobile.MobileNotificationArea')

    const onPressHome = e => {
        e?.preventDefault()
        if (store.getState().expandedNavPicker) {
            expandSecondaryBar?.()
        }
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
        if (store.getState().expandedNavPicker) {
            expandSecondaryBar?.()
        }
        dispatch([hideFloatPopup(), setSearchText(''), showGlobalSearchPopup(false)])
        dismissAllPopups()
    }

    const onPressUpdates = e => {
        const { selectedProjectIndex, route, expandedNavPicker } = store.getState()

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

        if (expandedNavPicker) expandSecondaryBar?.()
    }

    const feedAmount = followedFeedsAmount === 0 ? allFeedsAmount : followedFeedsAmount
    const activeFeedTab = followedFeedsAmount === 0 && allFeedsAmount > 0 ? ALL_TAB : FOLLOWED_TAB

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={[localStyles.button, { marginLeft: 0 }]} onPress={onPressHome} accessible={false}>
                <Icon size={24} name={'home'} color={theme.searchIcon} />
            </TouchableOpacity>

            <TouchableOpacity style={localStyles.button} onPress={onPressSearch} accessible={false}>
                <Icon size={24} name={'search'} color={theme.searchIcon} />
            </TouchableOpacity>

            <TouchableOpacity style={localStyles.button} onPress={onPressUpdates} accessible={false}>
                <Icon size={24} name={'bell'} color={theme.bellIcon} />

                {feedAmount > 0 && (
                    <View style={localStyles.updatesBadge}>
                        <AmountTag feedAmount={feedAmount} isFollowedButton={activeFeedTab === FOLLOWED_TAB} />
                    </View>
                )}
            </TouchableOpacity>

            <TouchableOpacity style={localStyles.button} onPress={expandSecondaryBar} accessible={false}>
                <Icon size={24} name={'more-vertical'} color={theme.moreVerticalIcon} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: 16,
        height: 56,
    },
    statisticArea: {
        flexDirection: 'row',
    },
    notificationArea: {
        flexDirection: 'row',
    },
    itemsContainerMobile: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        height: 0,
        paddingHorizontal: 16,
        marginLeft: -18,
        overflow: 'hidden',
    },
    button: {
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
})
