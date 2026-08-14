import React from 'react'
import { StyleSheet, View } from 'react-native'

import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'

export default function LastComment({
    project,
    setAModalIsOpen,
    currentProjectChatLastNotification,
    currentLastAssistantCommentData,
    compact = false,
}) {
    const followedNotification = currentProjectChatLastNotification?.followed
        ? currentProjectChatLastNotification
        : null
    const hasNotification = !!followedNotification
    const hasValidLastCommentData =
        !!currentLastAssistantCommentData &&
        !!currentLastAssistantCommentData.objectId &&
        !!currentLastAssistantCommentData.objectType

    if (!hasNotification && !hasValidLastCommentData) {
        console.warn('LastComment: missing or invalid lastAssistantCommentData; skipping render', {
            currentLastAssistantCommentData,
        })
        return null
    }
    return (
        <View style={[localStyles.container, compact && localStyles.containerCompact]}>
            {followedNotification ? (
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId={followedNotification.chatId}
                    objectType={followedNotification.chatType}
                    setAModalIsOpen={setAModalIsOpen}
                    fromChatNotification={true}
                    isFollowedNotification={true}
                    compact={compact}
                />
            ) : (
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId={currentLastAssistantCommentData.objectId}
                    objectType={currentLastAssistantCommentData.objectType}
                    setAModalIsOpen={setAModalIsOpen}
                    compact={compact}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignContent: 'flex-start',
        flex: 1,
        marginLeft: 16,
    },
    containerCompact: {
        marginLeft: 0,
        width: 'auto',
        maxWidth: '100%',
    },
})
