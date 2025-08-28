import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { intersection } from 'lodash'

import Button from '../../../UIControls/Button'
import { getPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import SelectedUsersTable from './SelectedUsersTable'
import Line from '../../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import PaymentInfo from './PaymentInfo'
import PaymentInfoEditingUsers from './PaymentInfoEditingUsers'
import { getSubscriptionStatus, PAYMENT_METHOD_CREDIT_CARD, removeUsersPaidByOtherUser } from '../../PremiumHelper'
import store from '../../../../redux/store'
import {
    activateSubscription,
    createCompanySubscription,
    updateActivePaidUsersInActiveSubscription,
} from '../../../../utils/backends/Premium/premiumFirestore'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import useWindowSize from '../../../../utils/useWindowSize'
import Backend from '../../../../utils/BackendBridge'

export default function PaymentPreviewModal({ paymentMethod, closeModal, selectedUserIds, companyData, subscription }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [processing, setProcessing] = useState(false)
    const [width, height] = useWindowSize()

    const {
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActiveSubscription,
        isCanceledSubscription,
        isActivationPendingSubscription,
    } = getSubscriptionStatus(subscription)

    const handlePayment = async () => {
        setProcessing(true)
        Backend.logEvent('click_to_mollie', {
            userId: loggedUserId,
        })

        if (paymentMethod === PAYMENT_METHOD_CREDIT_CARD) {
            const { uid, customerId, displayName, email } = store.getState().loggedUser
            if (isPendingSubscription || isEditingUsersPendingSubscription || isActivationPendingSubscription) {
                const { paymentLink } = subscription
                window.open(paymentLink, '_self')
            } else if (isActiveSubscription) {
                const sameIds = intersection(selectedUserIds, subscription.activePaidUsersIds)
                const thereAreNotChanges =
                    sameIds.length === selectedUserIds.length &&
                    sameIds.length === subscription.activePaidUsersIds.length
                if (thereAreNotChanges) {
                    closeModal()
                } else {
                    updateActivePaidUsersInActiveSubscription(
                        { ...subscription, selectedUserIds: [...selectedUserIds] },
                        closeModal
                    ).then(async param => {
                        param && param.data && param.data.checkout
                            ? window.open(param.data.checkout, '_self')
                            : closeModal()
                    })
                }
            } else if (isCanceledSubscription) {
                activateSubscription({ ...subscription, selectedUserIds: [...selectedUserIds] }, closeModal).then(
                    async param => {
                        param && param.data && param.data.checkout
                            ? window.open(param.data.checkout, '_self')
                            : closeModal()
                    }
                )
            } else {
                const usersToPayForIds = await removeUsersPaidByOtherUser(selectedUserIds)
                usersToPayForIds.length > 0
                    ? createCompanySubscription({
                          customerId,
                          userId: uid,
                          userName: displayName,
                          userEmail: email,
                          selectedUserIds: usersToPayForIds,
                          companyData,
                          paymentMethod,
                          urlOrigin: window.location.origin,
                      }).then(async ({ data }) => {
                          window.open(data.checkout, '_self')
                      })
                    : closeModal()
            }
        }
    }

    const title =
        isActiveSubscription || isEditingUsersPendingSubscription
            ? 'Check info before update users'
            : isCanceledSubscription || isActivationPendingSubscription
            ? 'Check info before activating the subscription'
            : 'Check info before payment'

    const description =
        isActiveSubscription || isEditingUsersPendingSubscription
            ? 'Check info before edit payment users description'
            : isCanceledSubscription || isActivationPendingSubscription
            ? 'Check info before activating the subscription description'
            : 'Check info before payment description'

    return (
        <View
            style={[
                localStyles.container,
                {
                    minWidth: getPopoverWidth(),
                    maxWidth: getPopoverWidth(),
                    maxHeight: height - MODAL_MAX_HEIGHT_GAP,
                },
            ]}
        >
            <ModalHeader closeModal={closeModal} title={translate(title)} description={translate(description)} />
            <CustomScrollView indicatorStyle={{ right: -10 }}>
                <SelectedUsersTable subscription={subscription} selectedUserIds={selectedUserIds} />
            </CustomScrollView>
            <Line style={{ marginBottom: 16 }} />

            {isActiveSubscription ||
            isEditingUsersPendingSubscription ||
            isCanceledSubscription ||
            isActivationPendingSubscription ? (
                <PaymentInfoEditingUsers subscription={subscription} />
            ) : (
                <PaymentInfo selectedUserIds={selectedUserIds} />
            )}

            <View style={localStyles.buttons}>
                <Button
                    title={translate('Proceed')}
                    disabled={processing}
                    processing={processing}
                    processingTitle={translate('Loading')}
                    onPress={handlePayment}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        top: '50%',
        left: '57%',
        transform: [{ translateX: '-60%' }, { translateY: '-50%' }],
        position: 'fixed',
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        padding: 16,
    },
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
