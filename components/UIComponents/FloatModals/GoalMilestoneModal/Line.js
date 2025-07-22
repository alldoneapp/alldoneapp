import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../styles/global'

export default function Line({ style }) {
    return <View style={[localStyles.line, style]} />
}

const localStyles = StyleSheet.create({
    line: {
        height: 1,
        backgroundColor: '#FFFFFF',
        opacity: 0.2,
        marginVertical: 8,
        marginHorizontal: -16,
    },
})
