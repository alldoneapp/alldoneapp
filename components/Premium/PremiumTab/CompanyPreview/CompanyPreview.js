import React from 'react'
import { View } from 'react-native'

import SelectedUsersArea from './SelectedUsersArea'
import SelectPremiumUsersModalWrapper from '../SelectPremiumUsersModal/SelectPremiumUsersModalWrapper'
import PaymentInfo from './PaymentInfo'
import BillingAddress from './BillingAddress'
import CreditCard from './CreditCard'
import Header from './Header'
import ButtonsArea from './ButtonsArea'
import PaymentInfoActive from './PaymentInfoActive'
import { getSubscriptionStatus } from '../../PremiumHelper'

export default function CompanyPreview({
    companyData,
    setCompanyData,
    selectedUserIds,
    setSelectedUsersIds,
    openPaymenthMethods,
    inCompanyPreviewStep,
    resetData,
    subscription,
}) {
    const {
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActiveSubscription,
        isActivationPendingSubscription,
        isCanceledSubscription,
        isUpdateCreditCardPendingSubscription,
    } = getSubscriptionStatus(subscription)
    const usePersistentSave = !!subscription
    const usersAmount = selectedUserIds.length

    return (
        <>
            <Header subscription={subscription} usersAmount={usersAmount} />
            <View style={{ paddingHorizontal: 16 }}>
                <SelectedUsersArea
                    selectedUserIds={selectedUserIds}
                    setSelectedUsersIds={setSelectedUsersIds}
                    subscription={subscription}
                />
                {!isPendingSubscription &&
                    !isEditingUsersPendingSubscription &&
                    !isActivationPendingSubscription &&
                    !isUpdateCreditCardPendingSubscription && (
                        <SelectPremiumUsersModalWrapper
                            usePersistentSave={usePersistentSave}
                            selectedUserIds={selectedUserIds}
                            setSelectedUsersIds={setSelectedUsersIds}
                            subscription={subscription}
                        />
                    )}
                <PaymentInfo
                    usersAmount={usersAmount}
                    containerStyle={
                        isPendingSubscription ||
                        isEditingUsersPendingSubscription ||
                        isActivationPendingSubscription ||
                        isUpdateCreditCardPendingSubscription
                            ? { marginTop: 16 }
                            : null
                    }
                />
                {isActiveSubscription && <PaymentInfoActive subscription={subscription} />}
                <BillingAddress
                    usePersistentSave={usePersistentSave}
                    setCompanyData={setCompanyData}
                    companyData={companyData}
                    subscription={subscription}
                />
                {(isActiveSubscription || isCanceledSubscription) && <CreditCard subscription={subscription} />}
                {inCompanyPreviewStep && (
                    <ButtonsArea
                        subscription={subscription}
                        companyData={companyData}
                        selectedUserIds={selectedUserIds}
                        openPaymenthMethods={openPaymenthMethods}
                        resetData={resetData}
                    />
                )}
            </View>
        </>
    )
}
