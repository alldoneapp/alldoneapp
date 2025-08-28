import React from 'react'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ChatIndicator from '../../../ChatsView/ChatIndicator'
import {
    getFollowedAndUnfollowedChatNotificationsAmount,
    resetNotificationsWhenUserHasAnActiveChat,
} from '../../../../utils/backends/Chats/chatsComments'

export default function ChatsAmount({ inAllProjects, projectId }) {
    let projectChatNotifications = useSelector(state => state.projectChatNotifications)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const activeChatData = useSelector(state => state.activeChatData)

    projectChatNotifications = resetNotificationsWhenUserHasAnActiveChat(projectChatNotifications, activeChatData)

    const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        inAllProjects,
        projectId,
        projectChatNotifications,
        archivedProjectIds,
        templateProjectIds
    )

    const notificationsAmount = totalFollowed || totalUnfollowed
    const backgroundColor = totalFollowed ? colors.UtilityRed200 : colors.Gray500

    return (
        !!notificationsAmount && (
            <ChatIndicator notificationsAmount={notificationsAmount} backgroundColor={backgroundColor} />
        )
    )
}
