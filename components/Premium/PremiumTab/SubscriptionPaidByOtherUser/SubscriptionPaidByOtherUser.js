import React from 'react'
import { StyleSheet, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CompanyData from './CompanyData'
import PayingYourPremiumStatus from '../CompanyPreview/PayingYourPremiumStatus'
import CancelSubscriptionPaidByOtherUserWrapper from './CancelSubscriptionPaidByOtherUserWrapper'
import CanceledSubscriptionHeader from './CanceledSubscriptionHeader'

export default function SubscriptionPaidByOtherUser({ subscription }) {
    const { canceled, subscriptionEndDate, pending } = subscription
    return (
        <View style={[localStyles.container, canceled && { paddingTop: 0 }]}>
            {canceled && <CanceledSubscriptionHeader subscriptionEndDate={subscriptionEndDate} />}
            <View style={{ paddingHorizontal: 16 }}>
                <CompanyData subscription={subscription} />
                <PayingYourPremiumStatus pending={pending} />
            </View>
            {!canceled && !pending && (
                <CancelSubscriptionPaidByOtherUserWrapper userPayingId={subscription.userPayingId} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Gray200,
        borderRadius: 4,
        paddingVertical: 16,
        marginBottom: 22,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
})
