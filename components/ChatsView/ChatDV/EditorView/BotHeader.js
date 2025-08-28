import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import global, { colors } from '../../../styles/global'
import { getAssistantInProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotHeader({ projectId, assistantId }) {
    const { photoURL50, displayName } = getAssistantInProjectObject(projectId, assistantId)

    return (
        <View style={{ flexDirection: 'row' }}>
            <AssistantAvatar photoURL={photoURL50} assistantId={assistantId} size={24} />
            <Text style={localStyles.userName}>{displayName}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    userName: {
        ...global.subtitle2,
        marginLeft: 12,
        color: colors.Text02,
    },
})
