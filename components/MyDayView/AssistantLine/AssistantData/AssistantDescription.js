import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles from '../../../styles/global'

export default function AssistantDescription({ description }) {
    return (
        <Text numberOfLines={2} style={localStyles.text}>
            {description}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.caption2,
        color: '#000000',
        flexWrap: 'wrap',
    },
})
