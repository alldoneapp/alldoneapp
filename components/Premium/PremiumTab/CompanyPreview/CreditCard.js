import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import CompanyAddressModalWrapper from '../CompanyAddressModal/CompanyAddressModalWrapper'
import CreditCardNumber from './CreditCardNumber'
import Button from '../../../UIControls/Button'
import UpdateCreditCard from './UpdateCreditCard'

export default function CreditCard({ subscription }) {
    const { cardNumber } = subscription

    return (
        <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.subtitle1}>{translate('Credit card')}</Text>
            </View>
            <CreditCardNumber cardNumber={cardNumber} />
            <UpdateCreditCard />
        </View>
    )
}

const localStyles = StyleSheet.create({
    info: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    billingAddress: {
        ...styles.body1,
        color: colors.Text01,
        marginVertical: 8,
    },
})
