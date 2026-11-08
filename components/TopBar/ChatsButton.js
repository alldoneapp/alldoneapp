import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../Icon'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import { hideFloatPopup, navigateToAllProjectsChats } from '../../redux/actions'
import { ROOT_ROUTES } from '../../utils/TabNavigationConstants'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import {
    getFollowedAndUnfollowedChatNotificationsAmount,
    resetNotificationsWhenUserHasAnActiveChat,
} from '../../utils/backends/Chats/chatsComments'
import NavigationService from '../../utils/NavigationService'
import store from '../../redux/store'
import { getChatsButtonBadge } from './chatsButtonHelper'
import { isChatsViewActive, SELECTED_TOP_BAR_ICON_COLOR, selectedTopBarButtonStyle } from './topBarNavSelection'

export default function ChatsButton({ color, style, onNavigate }) {
    const dispatch = useDispatch()
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const activeChatData = useSelector(state => state.activeChatData)
    const selected = useSelector(isChatsViewActive)
    let projectChatNotifications = useSelector(state => state.projectChatNotifications)

    projectChatNotifications = resetNotificationsWhenUserHasAnActiveChat(projectChatNotifications, activeChatData)

    const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        true,
        '',
        projectChatNotifications,
        archivedProjectIds,
        templateProjectIds
    )
    const badge = getChatsButtonBadge(totalFollowed, totalUnfollowed)

    const onPress = e => {
        e?.preventDefault()
        const { route } = store.getState()

        dismissAllPopups(true, true, true)
        dispatch([
            hideFloatPopup(),
            navigateToAllProjectsChats({ chatsActiveTab: badge.tab, unreadOnly: badge.amount > 0 }),
        ])

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
        onNavigate?.()
    }

    return (
        <TouchableOpacity
            style={[localStyles.button, style, selected && selectedTopBarButtonStyle]}
            onPress={onPress}
            accessible={false}
            testID="top-bar-chats-button"
        >
            <Icon size={24} name={'message-circle'} color={selected ? SELECTED_TOP_BAR_ICON_COLOR : color} />

            {badge.amount > 0 && (
                <View style={localStyles.badge}>
                    <AmountTag feedAmount={badge.amount} isFollowedButton={badge.isFollowed} />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        width: 28,
    },
    badge: {
        position: 'absolute',
        top: -3,
        left: 14,
    },
})
