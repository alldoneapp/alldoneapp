import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

const ContactsHeader = ({ contactAmount }) => {
    const parseText = number => {
        return translate(number > 1 ? 'Amount members' : 'Amount member', { amount: number })
    }

    return (
        <View style={localStyles.container}>
            <Text style={[styles.caption2, localStyles.amountText, { color: colors.Text02 }]}>
                {parseText(contactAmount)}
            </Text>
        </View>
    )
}

export default ContactsHeader

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    amountText: {
        textAlign: 'left',
        alignSelf: 'flex-start',
        marginTop: -8,
        paddingLeft: 12,
    },
})
