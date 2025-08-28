import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { View } from 'react-native'

import CancelSubscriptionModalWrapper from '../CancelSubscriptionModal/CancelSubscriptionModalWrapper'
import SuccessfullyPayment from './SuccessfullyPayment'
import PayingYourPremiumStatus from './PayingYourPremiumStatus'
import { hideSuccessfullyPaymentStatus } from '../../../../utils/backends/Premium/premiumFirestore'

export default function ActiveButtonsArea({ subscription }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const { showSuccessfullyPayment } = subscription

    useEffect(() => {
        if (showSuccessfullyPayment) {
            setTimeout(() => {
                hideSuccessfullyPaymentStatus(loggedUserId)
            }, 5000)
        }
    }, [showSuccessfullyPayment])

    return (
        <>
            <PayingYourPremiumStatus />
            {showSuccessfullyPayment ? (
                <SuccessfullyPayment />
            ) : (
                <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                    <CancelSubscriptionModalWrapper subscription={subscription} userId={loggedUserId} />
                </View>
            )}
        </>
    )
}
