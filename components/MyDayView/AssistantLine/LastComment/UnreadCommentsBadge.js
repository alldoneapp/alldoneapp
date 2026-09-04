import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '../../../styles/global'

export default function UnreadCommentsBadge({ amount, followed }) {
    if (!(amount > 0)) return null

    const displayedAmount = amount > 99 ? '+99' : amount
    const backgroundColor = followed ? colors.UtilityRed200 : colors.Gray500

    return (
        <View style={[localStyles.container, { backgroundColor }]} testID="unread-comments-badge">
            <Text style={localStyles.text}>{displayedAmount}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minWidth: 16,
        height: 16,
        paddingHorizontal: 3,
        borderRadius: 100,
        position: 'absolute',
        right: -5,
        top: -5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#FFFFFF',
        fontSize: 10,
        lineHeight: 12,
        fontWeight: 'bold',
    },
})
