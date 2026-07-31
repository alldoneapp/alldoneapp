import React from 'react'
import { View, StyleSheet } from 'react-native'

import BotHeader from './BotHeader'
import AssistantProgress from '../../../ChatsView/ChatDV/EditorView/AssistantProgress'

export default function BotMessagePlaceholder({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerContainer}>
                <BotHeader projectId={projectId} assistantId={assistantId} />
            </View>
            <AssistantProgress activity={{ phase: 'preparing' }} compact={true} appearance="dark" />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        padding: 8,
        marginBottom: 8,
        paddingTop: 0,
    },
    headerContainer: {
        marginBottom: 8,
    },
})
