import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { calculatePrice, NET_PRICE, VAT_PERCENT, VAT_TO_APPLY } from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PaymentInfo({ selectedUserIds }) {
    const usersAmount = selectedUserIds.length
    const totalSubTotalPrice = NET_PRICE * usersAmount
    const totalVAT = VAT_TO_APPLY * usersAmount
    const totalPrice = calculatePrice(usersAmount)
    const VAT = VAT_PERCENT * 100

    return (
        <View>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                <Text style={localStyles.prices}>Sub Total: {totalSubTotalPrice.toFixed(2)} €</Text>
                <Text style={localStyles.prices}>VAT: {VAT}%</Text>
                <Text style={localStyles.prices}>Total VAT: {totalVAT.toFixed(2)} €</Text>
            </View>

            <Text style={[styles.title7, { color: colors.UtilityGreen150, marginBottom: 16 }]}>
                {translate('Total payment:')} {totalPrice} €
            </Text>

            <View style={localStyles.info}>
                <Text style={[styles.body2, { color: colors.Text03 }]}>
                    <Icon name={'info'} size={16} color={colors.Text03} style={localStyles.iconResponsive} />
                    {translate(
                        usersAmount === 1 ? 'new selected users to pay SINGULAR' : 'new selected users to pay PLURAL',
                        {
                            usersAmount,
                            amountToPay: totalPrice,
                        }
                    )}
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    info: {
        flexDirection: 'row',
    },
    prices: {
        ...styles.subtitle2,
        color: '#fff',
        marginRight: 16,
    },
    iconResponsive: {
        marginRight: 8,
        top: 2,
    },
})
