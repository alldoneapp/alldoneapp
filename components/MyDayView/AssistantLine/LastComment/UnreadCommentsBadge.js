import React from 'react'
import { Animated, StyleSheet, Text } from 'react-native'

import { colors } from '../../../styles/global'

// AT-2511 — `style` carries the arrival pop, and it is taken as a prop rather than applied by a
// wrapper on purpose: this badge is `position: absolute` against the comment card's corner, and a
// react-native-web `View` is `position: relative` by default, so wrapping it would re-anchor it to
// a zero-sized box instead of the card. An `Animated.View` accepting the transform directly keeps
// the badge exactly where it has always been, animated or not.
export default function UnreadCommentsBadge({ amount, followed, style }) {
    if (!(amount > 0)) return null

    const displayedAmount = amount > 99 ? '+99' : amount
    const backgroundColor = followed ? colors.UtilityRed200 : colors.Gray500

    return (
        <Animated.View style={[localStyles.container, { backgroundColor }, style]} testID="unread-comments-badge">
            <Text style={localStyles.text}>{displayedAmount}</Text>
        </Animated.View>
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
