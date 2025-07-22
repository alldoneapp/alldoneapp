import React from 'react'
import { StyleSheet, Animated, View } from 'react-native'

import { colors } from '../../../../styles/global'

export default function ActionPopupIndicator({ visible = false, borderColor = '#ffffff' }) {
    return visible ? (
        <Animated.View style={[localStyles.container, { backgroundColor: borderColor }]}>
            <View style={localStyles.square} />
        </Animated.View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        width: 10,
        height: 10,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        backgroundColor: '#ffffff',
        position: 'absolute',
        borderBottomLeftRadius: 4,
        top: 0,
        right: 0,
    },
    square: {
        width: 8,
        height: 8,
        backgroundColor: colors.Text04,
        borderRadius: 2,
        top: 0,
        right: 0,
    },
})
