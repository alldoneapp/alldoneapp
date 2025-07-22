import React from 'react'
import { StyleSheet, View } from 'react-native'
import DeleteTaskButton from './DeleteTaskButton'

export default function DeleteTask({ projectId, task }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginLeft: 'auto' }}>
                <DeleteTaskButton projectId={projectId} task={task} />
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
