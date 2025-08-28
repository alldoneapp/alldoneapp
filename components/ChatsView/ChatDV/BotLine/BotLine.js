import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import GoldArea from '../../../TopBar/GoldArea'
import BotOptionsModalWrapper from './BotOptionsModalWrapper'
import CloseButton from './CloseButton'

export default function BotLine({ setFullscreen, objectId, objectType, assistantId, projectId }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.leftArea}>
                <CloseButton setFullscreen={setFullscreen} />
                <BotOptionsModalWrapper
                    objectId={objectId}
                    objectType={objectType}
                    assistantId={assistantId}
                    projectId={projectId}
                />
            </View>
            <View style={localStyles.rightArea}>
                <GoldArea containerStyle={{ backgroundColor: '#ffffff' }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        paddingVertical: 8,
        borderRadius: 4,
    },
    leftArea: {
        flexDirection: 'row',
    },
    rightArea: {
        flexDirection: 'row',
        paddingVertical: 6,
        marginRight: 16,
    },
})
