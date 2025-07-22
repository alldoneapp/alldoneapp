import React from 'react'
import { View, StyleSheet } from 'react-native'

import PaymentPreviewModalWrapper from '../PaymentPreviewModal/PaymentPreviewModalWrapper'
import { getSubscriptionStatus } from '../../PremiumHelper'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function PendingButtonsArea({ subscription }) {
    const { paymentMethod, selectedUserIds } = subscription
    const { isUpdateCreditCardPendingSubscription } = getSubscriptionStatus(subscription)

    const completeCardUpdate = () => {
        const { paymentLink } = subscription
        window.open(paymentLink, '_self')
    }

    return (
        <View style={localStyles.buttons}>
            {isUpdateCreditCardPendingSubscription ? (
                <Button
                    title={translate('Complete card update')}
                    type={'primary'}
                    onPress={completeCardUpdate}
                    icon={'credit-card'}
                />
            ) : (
                <PaymentPreviewModalWrapper
                    selectedUserIds={selectedUserIds}
                    paymentMethod={paymentMethod}
                    subscription={subscription}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 18,
    },
})
