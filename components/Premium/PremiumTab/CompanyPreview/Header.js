import React from 'react'

import BilledMonthly from './BilledMonthly'
import InactiveHeader from './InactiveHeader'
import ActiveHeader from './ActiveHeader'
import PendingHeader from './PendingHeader'
import CanceledHeader from './CanceledHeader'

import { getSubscriptionStatus } from '../../PremiumHelper'

export default function Header({ usersAmount, subscription }) {
    const {
        isInactiveSubscription,
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActiveSubscription,
        isCanceledSubscription,
        isActivationPendingSubscription,
        isUpdateCreditCardPendingSubscription,
    } = getSubscriptionStatus(subscription)

    return (
        <>
            {isInactiveSubscription ? (
                <InactiveHeader />
            ) : isPendingSubscription ||
              isEditingUsersPendingSubscription ||
              isActivationPendingSubscription ||
              isUpdateCreditCardPendingSubscription ? (
                <PendingHeader selectedUsersAmount={usersAmount} />
            ) : isActiveSubscription ? (
                <ActiveHeader selectedUsersAmount={usersAmount} nextPaymentDate={subscription.nextPaymentDate} />
            ) : isCanceledSubscription ? (
                <CanceledHeader subscription={subscription} />
            ) : (
                <BilledMonthly selectedUsersAmount={usersAmount} />
            )}
        </>
    )
}
