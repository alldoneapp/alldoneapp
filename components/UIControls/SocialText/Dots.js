import React from 'react'
import { Animated, StyleSheet, Text } from 'react-native'

import styles, { colors } from '../../styles/global'

export default function Dots({ textStyle, normalStyle, isSubtask, hasStar, bgColor }) {
    return (
        <Animated.View
            style={[
                styles.body1,
                localStyles.ellipsis,
                textStyle,
                normalStyle,
                { justifyContent: 'center' },
                isSubtask ? { backgroundColor: colors.Grey200 } : undefined,
                hasStar ? { backgroundColor: hasStar } : undefined,
                bgColor ? { backgroundColor: bgColor } : undefined,
            ]}
        >
            <Text>...</Text>
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    ellipsis: {
        position: 'absolute',
        right: 0,
        backgroundColor: '#ffffff',
    },
})
