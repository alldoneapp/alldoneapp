import React, { useState, useEffect } from 'react'
import Popover from 'react-tiny-popover'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import PaymentPreviewModal from './PaymentPreviewModal'
import { getSubscriptionStatus } from '../../PremiumHelper'

export default function PaymentPreviewModalWrapper({
    paymentMethod,
    selectedUserIds,
    companyData,
    disabled,
    buttonStyle,
    subscription,
    allowEmptyUsersSelection,
}) {
    const [showModal, setShowModal] = useState(false)

    const {
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActivationPendingSubscription,
    } = getSubscriptionStatus(subscription)

    const openModal = () => {
        setShowModal(true)
    }

    const closeModal = () => {
        setShowModal(false)
    }

    useEffect(() => {
        if ((disabled || selectedUserIds.length === 0) && showModal)
            setTimeout(() => {
                closeModal()
            }, 900)
    }, [disabled, selectedUserIds])

    const buttonText =
        isPendingSubscription || isEditingUsersPendingSubscription || isActivationPendingSubscription
            ? 'Complete payment'
            : 'Continue'

    const showButtonCreditCardIcon =
        (isPendingSubscription || isEditingUsersPendingSubscription || isActivationPendingSubscription) && 'credit-card'

    return (
        <Popover
            position={['top', 'left', 'right', 'bottom']}
            padding={4}
            align={'center'}
            onClickOutside={closeModal}
            isOpen={showModal}
            content={
                <PaymentPreviewModal
                    paymentMethod={paymentMethod}
                    closeModal={closeModal}
                    selectedUserIds={selectedUserIds}
                    companyData={companyData}
                    subscription={subscription}
                />
            }
        >
            <Button
                buttonStyle={buttonStyle}
                disabled={(!allowEmptyUsersSelection && selectedUserIds.length === 0) || disabled}
                title={translate(buttonText)}
                type={'primary'}
                onPress={openModal}
                icon={showButtonCreditCardIcon}
            />
        </Popover>
    )
}
