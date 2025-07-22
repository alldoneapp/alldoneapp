import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'

export default function ReddBubble() {
    return <View style={localStyles.container}></View>
}

const localStyles = StyleSheet.create({
    container: {
        width: 12,
        height: 12,
        backgroundColor: colors.UtilityRed200,
        borderRadius: 100,
        position: 'absolute',
        right: -3,
        top: -3,
    },
})
