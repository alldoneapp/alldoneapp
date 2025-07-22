import React from 'react'
import { StyleSheet, View } from 'react-native'

import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'

export default function LastComment({
    project,
    setAModalIsOpen,
    currentProjectChatLastNotification,
    currentLastAssistantCommentData,
}) {
    return (
        <View style={localStyles.container}>
            {currentProjectChatLastNotification ? (
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId={currentProjectChatLastNotification.chatId}
                    objectType={currentProjectChatLastNotification.chatType}
                    setAModalIsOpen={setAModalIsOpen}
                    fromChatNotification={true}
                />
            ) : (
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId={currentLastAssistantCommentData.objectId}
                    objectType={currentLastAssistantCommentData.objectType}
                    setAModalIsOpen={setAModalIsOpen}
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
})
