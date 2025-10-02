import React, { useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import AssistantOptions from './AssistantOptions/AssistantOptions'
import { calculateAmountOfOptionButtons } from './AssistantOptions/helper'
import LastCommentArea from './LastCommentArea'

export default function AssistantLine() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const globalAssistants = useSelector(state => state.globalAssistants)
    const loggedUser = useSelector(state => state.loggedUser)
    const [amountOfButtonOptions, setAmountOfButtonOptions] = useState(0)

    const onLayout = data => {
        const amountOfButtonOptions = calculateAmountOfOptionButtons(data.nativeEvent.layout.width, isMiddleScreen)
        setAmountOfButtonOptions(amountOfButtonOptions)
    }

    const hasRequiredData = defaultAssistant && defaultAssistant.uid && loggedUser && loggedUser.defaultProjectId

    if (!hasRequiredData) {
        return (
            <View style={localStyles.container} onLayout={onLayout}>
                <View style={localStyles.loadingContainer}>
                    <Text style={localStyles.loadingText}>Loading assistant...</Text>
                </View>
            </View>
        )
    }

    return (
        <View style={localStyles.container} onLayout={onLayout}>
            <View style={localStyles.commentRow}>
                <LastCommentArea />
            </View>
            <AssistantOptions amountOfButtonOptions={amountOfButtonOptions} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey100,
        marginTop: 8,
        borderRadius: 4,
        minHeight: 128,
        paddingLeft: 10,
        paddingRight: 16,
        paddingTop: 14,
        paddingBottom: 12,
    },
    commentRow: {
        marginBottom: 12,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 14,
        color: colors.Grey600,
    },
})
