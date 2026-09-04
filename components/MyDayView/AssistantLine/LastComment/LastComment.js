import React from 'react'
import { StyleSheet, View } from 'react-native'

import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'
import NoComment from '../NoComment/NoComment'

export default function LastComment({
    project,
    setAModalIsOpen,
    currentProjectChatLastNotification,
    currentLastAssistantCommentData,
    compact = false,
    assistant,
    scopeKey = null,
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
        return compact ? null : (
            <View style={localStyles.container}>
                <NoComment projectId={project.id} assistant={assistant} />
            </View>
        )
    }
    return (
        <View style={[localStyles.container, compact && localStyles.containerCompact]}>
            {followedNotification ? (
                <LastUserOrAssistantCommentContainer
                    key={`${project.id}:${followedNotification.chatType}:${followedNotification.chatId}`}
                    project={project}
                    objectId={followedNotification.chatId}
                    objectType={followedNotification.chatType}
                    setAModalIsOpen={setAModalIsOpen}
                    fromChatNotification={true}
                    isFollowedNotification={true}
                    compact={compact}
                    scopeKey={scopeKey}
                />
            ) : (
                <LastUserOrAssistantCommentContainer
                    key={`${project.id}:${currentLastAssistantCommentData.objectType}:${currentLastAssistantCommentData.objectId}`}
                    project={project}
                    objectId={currentLastAssistantCommentData.objectId}
                    objectType={currentLastAssistantCommentData.objectType}
                    setAModalIsOpen={setAModalIsOpen}
                    compact={compact}
                    scopeKey={scopeKey}
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
