import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles from '../../../styles/global'

export default function AssistantName({ name }) {
    return (
        <Text numberOfLines={1} style={localStyles.text}>
            {name}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.subtitle1,
        color: '#000000',
        flexWrap: 'wrap',
    },
})
