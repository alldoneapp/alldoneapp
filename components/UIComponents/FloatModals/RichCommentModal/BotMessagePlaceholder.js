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
            <View style={localStyles.statusRow}>
                <Spinner containerSize={18} spinnerSize={12} containerColor={colors.Gray400} />
                <Text style={localStyles.helperText}>Working on your request. Live tool updates will appear here.</Text>
            </View>
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
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 36,
        marginTop: 6,
    },
    helperText: {
        ...global.caption2,
        color: colors.Text03,
        marginLeft: 8,
        maxWidth: 360,
    },
})
