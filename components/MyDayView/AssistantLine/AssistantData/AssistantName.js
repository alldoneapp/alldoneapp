import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'

export default function AssistantName({ name }) {
    return (
        <Text numberOfLines={1} style={localStyles.text}>
            {name}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 14,
        lineHeight: 20,
        letterSpacing: styles.subtitle2.letterSpacing,
        color: colors.Text02,
        flexWrap: 'wrap',
    },
})
