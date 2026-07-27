import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { shallowEqual, useSelector } from 'react-redux'

import global, { colors } from '../../../styles/global'
import { resolveAssistantForProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotHeader({ projectId, assistantId }) {
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
            <AssistantAvatar photoURL={photoURL50} assistantId={effectiveAssistantId} size={24} />
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
