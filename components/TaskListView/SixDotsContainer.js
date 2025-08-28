import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../styles/global'
import Icon from '../Icon'

export default function SixDotsContainer() {
    return (
        <View style={localStyles.sixDots}>
            <Icon name="six-dots-vertical" size={24} color={colors.Text03} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    sixDots: {
        position: 'absolute',
        top: 8,
        right: 16,
    },
})
