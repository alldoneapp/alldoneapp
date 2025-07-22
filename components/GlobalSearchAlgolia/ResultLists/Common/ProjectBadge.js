import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'

export default function ProjectBadge({ value }) {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{value}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 20,
        borderRadius: 50,
        paddingVertical: 0,
        paddingHorizontal: 6,
        backgroundColor: colors.Primary200,
    },
    text: {
        ...styles.caption1,
        color: '#ffffff',
    },
})
