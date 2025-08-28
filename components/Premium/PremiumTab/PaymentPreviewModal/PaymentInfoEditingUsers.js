import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { difference } from 'lodash'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import {
    calculatePrice,
    getDaysLeftUntilNextPaymentPercent,
    NET_PRICE,
    PRICE,
    VAT_PERCENT,
    VAT_TO_APPLY,
} from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PaymentInfoEditingUsers({ subscription }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { selectedUserIds, activePaidUsersIds, paidUsersIds, nextPaymentDate } = subscription

    const monthlyTotalPrice = calculatePrice(selectedUserIds.length)

    const addedUserIds = difference(selectedUserIds, activePaidUsersIds)
    const newAddedUserIds = difference(addedUserIds, paidUsersIds)

    const daysLeftUntilNextPaymentPercent = getDaysLeftUntilNextPaymentPercent(nextPaymentDate)

    const newUsersPrice = (newAddedUserIds.length * PRICE * daysLeftUntilNextPaymentPercent).toFixed(2)
    const totalSubTotalNewUsersPrice = NET_PRICE * newAddedUserIds.length * daysLeftUntilNextPaymentPercent
    const newUsersVAT = VAT_PERCENT * 100
    const newUsersTotalVAT = VAT_TO_APPLY * newAddedUserIds.length * daysLeftUntilNextPaymentPercent

    return (
        <View>
            {newAddedUserIds.length > 0 && (
                <>
                    <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                        <Text style={localStyles.prices}>Sub Total: {totalSubTotalNewUsersPrice.toFixed(2)} €</Text>
                        <Text style={localStyles.prices}>VAT: {newUsersVAT}%</Text>
                        <Text style={localStyles.prices}>Total VAT: {newUsersTotalVAT.toFixed(2)} €</Text>
                    </View>

                    <Text style={[styles.title7, { color: colors.UtilityGreen150, marginBottom: 16 }]}>
                        {translate(smallScreenNavigation ? 'Payment new users' : 'Total payment new users')}{' '}
                        {newUsersPrice} €
                    </Text>
                </>
            )}
            <View style={localStyles.info}>
                <Text style={[styles.body2, { color: colors.Text03 }]}>
                    <Icon name={'info'} size={16} color={colors.Text03} style={localStyles.iconResponsive} />
                    {translate(
                        selectedUserIds.length === 1
                            ? 'selected users to pay SINGULAR'
                            : 'selected users to pay PLURAL',
                        {
                            usersAmount: selectedUserIds.length,
                            amountToPay: monthlyTotalPrice,
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
