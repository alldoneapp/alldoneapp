import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { setShowWebSideBar } from '../../../redux/actions'
import store from '../../../redux/store'
import ChatIndicator from '../../ChatsView/ChatIndicator'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import Colors from '../../../Themes/Colors'
import GoldArea from '../GoldArea'
import {
    getFollowedAndUnfollowedChatNotificationsAmount,
    resetNotificationsWhenUserHasAnActiveChat,
} from '../../../utils/backends/Chats/chatsComments'

export default function TopBarMobileStatisticArea({ expandSecondaryBar }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    let projectChatNotifications = useSelector(state => state.projectChatNotifications)
    const activeChatData = useSelector(state => state.activeChatData)

    projectChatNotifications = resetNotificationsWhenUserHasAnActiveChat(projectChatNotifications, activeChatData)

    const { totalFollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        true,
        '',
        projectChatNotifications,
        archivedProjectIds,
        templateProjectIds
    )

    const theme = getTheme(Themes, themeName, 'TopBarMobile.TopBarMobileStatisticArea')

    const showSideBar = e => {
        e?.preventDefault()
        dispatch(setShowWebSideBar())
        if (store.getState().expandedNavPicker) expandSecondaryBar?.()
    }

    return (
        <View style={localStyle.container}>
            {!!totalFollowed && (
                <View style={localStyle.indicator}>
                    <ChatIndicator backgroundColor={Colors.UtilityRed200} notificationsAmount={totalFollowed} />
                </View>
            )}
            <TouchableOpacity style={localStyle.menu} onPress={showSideBar} accessible={false}>
                <Icon name={'menu'} size={24} color={theme.menuIcon} />
            </TouchableOpacity>

            {!isAnonymous && <GoldArea />}
        </View>
    )
}

const localStyle = StyleSheet.create({
    container: {
        flexDirection: 'row',
        overflow: 'hidden',
    },
    menu: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        marginRight: 18,
        overflow: 'hidden',
    },
    indicator: {
        position: 'absolute',
        zIndex: 100,
        left: 10,
    },
})
