import React from 'react'
import { StyleSheet, View } from 'react-native'

import Shortcut from '../../../UIControls/Shortcut'

export default function ItemShortcut({ shortcut }) {
    return (
        <View style={localStyles.shortcut}>
            <Shortcut text={`Shift+${shortcut}`} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    shortcut: {
        position: 'absolute',
        top: 2,
        right: 2,
        zIndex: 10,
    },
})
