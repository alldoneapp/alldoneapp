import React from 'react'
import { Text, StyleSheet } from 'react-native'

import styles, { colors } from '../../../styles/global'

export default function CreditCardNumber({ cardNumber }) {
    return <Text style={localStyles.text}>{`**** **** **** ${cardNumber}`}</Text>
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.body1,
        color: colors.Text01,
        marginVertical: 8,
    },
})
