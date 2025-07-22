import React from 'react'
import { View, StyleSheet } from 'react-native'

import BotHeader from './BotHeader'
import Spinner from '../../../UIComponents/Spinner'

export default function BotMessagePlaceholder({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerContainer}>
                <BotHeader projectId={projectId} assistantId={assistantId} />
            </View>
            <Spinner containerSize={18} spinnerSize={12} containerStyle={localStyles.spinner} />
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
    spinner: {
        marginLeft: 36,
    },
})
