import React from 'react'
import { View, StyleSheet, Text } from 'react-native'

import global, { colors } from '../../../styles/global'

export default function CodeText({ lastItem, text, backgroundColor, textColor }) {
    const lines = text.split('\n')
    const header = lines.length > 1 ? lines[0] : ''
    const content = lines.length > 1 ? text.substring(lines[0].length) : lines[0]

    return (
        <View
            style={[!lastItem && { marginBottom: 16 }, localStyles.container, backgroundColor && { backgroundColor }]}
        >
            {header !== '' && <Text style={[localStyles.header, textColor && { color: textColor }]}>{header}</Text>}
            {content !== '' && <Text style={[localStyles.text, textColor && { color: textColor }]}>{content}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey400,
        paddingHorizontal: 14,
        paddingBottom: 9,
        paddingTop: 9,
        marginRight: 16,
    },
    text: {
        ...global.body2,
        color: colors.Text02,
    },
    header: {
        ...global.subtitle2,
        color: colors.Text02,
        marginBottom: 8,
    },
})
