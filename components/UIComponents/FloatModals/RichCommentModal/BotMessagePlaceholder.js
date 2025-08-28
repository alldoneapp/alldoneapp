import React from 'react'
import { View, StyleSheet } from 'react-native'

import BotHeader from './BotHeader'
import Spinner from '../../../UIComponents/Spinner'
import { colors } from '../../../styles/global'

export default function BotMessagePlaceholder({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerContainer}>
                <BotHeader projectId={projectId} assistantId={assistantId} />
            </View>
            <Spinner containerSize={18} spinnerSize={12} containerColor={colors.Gray400} />
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
