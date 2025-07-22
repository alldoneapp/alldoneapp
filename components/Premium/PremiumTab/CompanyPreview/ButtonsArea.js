import React from 'react'

import CreateSubscriptionButtonsArea from './CreateSubscriptionButtonsArea'
import InactiveButtonsArea from './InactiveButtonsArea'
import ActiveButtonsArea from './ActiveButtonsArea'
import PendingButtonsArea from './PendingButtonsArea'
import { getSubscriptionStatus } from '../../PremiumHelper'
import PayingYourPremiumStatus from './PayingYourPremiumStatus'

export default function ButtonsArea({ subscription, companyData, selectedUserIds, openPaymenthMethods, resetData }) {
    const {
        isInactiveSubscription,
        isPendingSubscription,
        isActiveSubscription,
        isEditingUsersPendingSubscription,
        isCanceledSubscription,
        isActivationPendingSubscription,
        isUpdateCreditCardPendingSubscription,
    } = getSubscriptionStatus(subscription)

    return (
        <>
            {isInactiveSubscription ? (
                <InactiveButtonsArea subscription={subscription} companyData={companyData} />
            ) : isPendingSubscription ||
              isEditingUsersPendingSubscription ||
              isActivationPendingSubscription ||
              isUpdateCreditCardPendingSubscription ? (
                <PendingButtonsArea subscription={subscription} />
            ) : isActiveSubscription ? (
                <ActiveButtonsArea subscription={subscription} />
            ) : isCanceledSubscription ? (
                <PayingYourPremiumStatus />
            ) : (
                <CreateSubscriptionButtonsArea
                    selectedUserIds={selectedUserIds}
                    openPaymenthMethods={openPaymenthMethods}
                    resetData={resetData}
                />
            )}
        </>
    )
}
