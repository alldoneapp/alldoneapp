import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { shallowEqual, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { resolveAssistantForProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotHeader({ projectId, assistantId }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    useSelector(
        state => ({
            projectAssistants: state.projectAssistants,
            globalAssistants: state.globalAssistants,
            defaultAssistant: state.defaultAssistant,
            loggedUserProjects: state.loggedUserProjects,
            loggedUserProjectsMap: state.loggedUserProjectsMap,
        }),
        shallowEqual
    )

    const assistant = resolveAssistantForProjectObject(projectId, assistantId)
    const effectiveAssistantId = assistant?.uid || assistantId
    const { photoURL50, displayName } = assistant || {}

    return (
        <View style={{ flexDirection: 'row' }}>
            <AssistantAvatar
                photoURL={photoURL50}
                assistantId={effectiveAssistantId}
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
