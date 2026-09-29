import React from 'react'
import { View, StyleSheet } from 'react-native'

import BotHeader from './BotHeader'
import AssistantProgress from './AssistantProgress'

export default function BotMessagePlaceholder({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerContainer}>
                <BotHeader projectId={projectId} assistantId={assistantId} />
            </View>
            <AssistantProgress activity={{ phase: 'preparing' }} compact={true} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingVertical: 8,
        marginLeft: 14,
        borderRadius: 4,
    },
    headerContainer: {
        marginTop: 8,
    },
})
