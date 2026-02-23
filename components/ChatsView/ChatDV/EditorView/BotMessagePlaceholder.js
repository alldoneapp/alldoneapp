import React from 'react'
import { View, StyleSheet, Text } from 'react-native'

import BotHeader from './BotHeader'
import Spinner from '../../../UIComponents/Spinner'
import global, { colors } from '../../../styles/global'

export default function BotMessagePlaceholder({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerContainer}>
                <BotHeader projectId={projectId} assistantId={assistantId} />
            </View>
            <Spinner containerSize={18} spinnerSize={12} containerStyle={localStyles.spinner} />
            <Text style={localStyles.helperText}>Working on your request. Live tool updates will appear here.</Text>
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
    helperText: {
        ...global.caption2,
        color: colors.Text03,
        marginLeft: 36,
        marginTop: 6,
        maxWidth: 360,
    },
})
