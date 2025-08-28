import React from 'react'
import { useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import AssistantLineAvatar from '../AssistantData/AssistantLineAvatar'
import AssistantData from '../AssistantData/AssistantData'

export default function AssistantDataContainer({ project, isAssistant, creator }) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.container}>
            <AssistantLineAvatar isAssistant={isAssistant} creator={creator} project={project} />
            {!isMiddleScreen && <AssistantData isAssistant={isAssistant} project={project} creator={creator} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
})
