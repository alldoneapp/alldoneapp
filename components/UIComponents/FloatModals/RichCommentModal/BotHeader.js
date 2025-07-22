import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { getAssistantInProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotHeader({ projectId, assistantId }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { photoURL50, displayName } = getAssistantInProjectObject(projectId, assistantId)

    return (
        <View style={{ flexDirection: 'row' }}>
            <AssistantAvatar
                photoURL={photoURL50}
                assistantId={assistantId}
                size={24}
                containerStyle={{ marginRight: 8 }}
            />
            <Text style={[localStyles.name, { maxWidth: smallScreenNavigation ? 130 : 250 }]} numberOfLines={1}>
                {displayName}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    name: {
        ...styles.subtitle1,
        color: colors.Text04,
    },
})
