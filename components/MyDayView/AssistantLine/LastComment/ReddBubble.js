import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '../../../styles/global'

export default function ReddBubble({ amount }) {
    const displayedAmount = amount > 99 ? '+99' : amount

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{displayedAmount}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minWidth: 16,
        height: 16,
        paddingHorizontal: 3,
        backgroundColor: colors.UtilityRed200,
        borderRadius: 100,
        position: 'absolute',
        right: -5,
        top: -5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: colors.White,
        fontSize: 10,
        lineHeight: 12,
        fontWeight: 'bold',
    },
})
