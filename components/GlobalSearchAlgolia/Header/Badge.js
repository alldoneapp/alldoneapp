import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../styles/global'

export default function Badge({ value }) {
    return value && value > 0 ? (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{value}</Text>
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        right: 0,
        top: -1,
        height: 12,
        borderRadius: 50,
        paddingVertical: 1,
        paddingHorizontal: 4,
        backgroundColor: colors.Primary200,
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
        color: '#ffffff',
    },
})
