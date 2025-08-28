import React from 'react'
import { StyleSheet, View } from 'react-native'
import Colors from '../../../Themes/Colors'

export default function FillLine({ style }) {
    return <View style={[localStyles.line, style]} />
}

const localStyles = StyleSheet.create({
    line: {
        flex: 1,
        height: 1,
        backgroundColor: Colors.Grey300,
    },
})
