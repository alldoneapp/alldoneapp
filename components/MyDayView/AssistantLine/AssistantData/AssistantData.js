import React from 'react'
import { StyleSheet, View } from 'react-native'

import AssistantName from './AssistantName'
import AssistantDescription from './AssistantDescription'
import GoToAssistantBoardButton from './GoToAssistantBoardButton'

export default function AssistantData({ isAssistant, project, creator }) {
    return (
        <View style={localStyles.container}>
            <AssistantName name={creator.displayName} />
            <AssistantDescription description={creator.description} />
            <GoToAssistantBoardButton isAssistant={isAssistant} project={project} creator={creator} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 16,
        width: 260,
        justifyContent: 'space-between',
    },
})
