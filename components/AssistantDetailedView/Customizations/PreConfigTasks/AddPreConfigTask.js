import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import AddPreConfigTaskWrapper from './AddPreConfigTaskWrapper'
import Button from '../../../UIControls/Button'

export default function AddPreConfigTask({ projectId, assistantId }) {
    return (
        <View style={localStyles.container}>
            <AddPreConfigTaskWrapper projectId={projectId} assistantId={assistantId} adding={true} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginVertical: 8,
    },
    button: {
        marginHorizontal: 0,
    },
})
