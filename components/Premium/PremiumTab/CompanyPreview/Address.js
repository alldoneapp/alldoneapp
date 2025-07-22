import React from 'react'
import { Text, StyleSheet } from 'react-native'

import styles, { colors } from '../../../styles/global'

export default function Address({ companyData }) {
    const { name, addressLine1, addressLine2, city, postalCode, country } = companyData
    const hasDataInTheAddress = !!(name || addressLine1 || addressLine2 || city || postalCode || country)

    return hasDataInTheAddress ? (
        <Text style={localStyles.text}>
            {`${name}, ${addressLine1}, ${addressLine2}, ${city}, ${postalCode}, ${country}`}
        </Text>
    ) : null
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.body1,
        color: colors.Text01,
        marginVertical: 8,
    },
})
