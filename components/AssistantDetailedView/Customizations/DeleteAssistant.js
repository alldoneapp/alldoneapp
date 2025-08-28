import React from 'react'
import { StyleSheet, View } from 'react-native'
import DeleteAssistantButton from './DeleteAssistantButton'

export default function DeleteAssistant({ isGlobalAsisstant, projectId, assistant }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginLeft: 'auto' }}>
                <DeleteAssistantButton
                    isGlobalAsisstant={isGlobalAsisstant}
                    projectId={projectId}
                    assistant={assistant}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
