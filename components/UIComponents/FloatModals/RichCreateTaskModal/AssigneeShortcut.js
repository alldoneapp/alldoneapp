import React from 'react'
import { StyleSheet, View } from 'react-native'

import Shortcut from '../../../UIControls/Shortcut'

export default function AssigneeShortcut() {
    return (
        <View style={localStyles.shortcut}>
            <Shortcut text={'A'} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    shortcut: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: 'rgba(138, 148, 166, 0.24)',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
