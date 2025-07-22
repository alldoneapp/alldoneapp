import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'

export default function HeaderKarma({ commentsAmount }) {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>Karma Update</Text>
            <Text style={localStyles.amount}>{`${commentsAmount} Comments`}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingBottom: 12,
    },
    title: {
        ...styles.title7,
        color: colors.Text01,
        marginTop: 22,
    },
    amount: {
        ...styles.caption2,
        color: colors.Text02,
        marginTop: 28,
        marginLeft: 16,
    },
})
