import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ChatsSwitchableTag from './ChatsSwitchableTag'
import { getFollowedAndUnfollowedChatNotificationsAmount } from '../../../utils/backends/Chats/chatsComments'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ChatsSwitchableTagContainer() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)

    const project = ProjectHelper.getProjectByIndex(selectedProjectIndex)
    const projectId = project ? project.id : ''

    const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        !projectId,
        projectId,
        projectChatNotifications,
        archivedProjectIds,
        templateProjectIds
    )

    return (
        <View style={localStyles.container}>
            <ChatsSwitchableTag
                smallScreenNavigation={smallScreenNavigation}
                amountFollowedFeeds={totalFollowed}
                amountAllFeeds={totalUnfollowed}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        right: 0,
        top: 44,
        zIndex: 10,
    },
})
