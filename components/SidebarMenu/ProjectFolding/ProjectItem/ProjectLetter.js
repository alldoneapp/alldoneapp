import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles from '../../../styles/global'

export default function ProjectLetter({ fontSize, lineHeight }) {
    return <Text style={[localStyles.text, { fontSize }, lineHeight ? { lineHeight } : null]}>C</Text>
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.body1,
    },
})
