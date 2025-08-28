import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import SelectedUsersTableTh from './SelectedUsersTableTh'
import SelectedUsersTableThHeaderText from './SelectedUsersTableThHeaderText'
import SelectedUsersTableContentItem from './SelectedUsersTableContentItem'
import { difference, intersection } from 'lodash'
import { getSubscriptionStatus } from '../../PremiumHelper'

export default function SelectedUsersTable({ subscription, selectedUserIds }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const {
        isActiveSubscription,
        isEditingUsersPendingSubscription,
        isCanceledSubscription,
        isActivationPendingSubscription,
    } = getSubscriptionStatus(subscription)

    const getUserIdsLists = subscription => {
        if (subscription) {
            const { activePaidUsersIds, paidUsersIds } = subscription
            const addedUserIds = difference(selectedUserIds, activePaidUsersIds)
            const removedUserIds = difference(activePaidUsersIds, selectedUserIds)
            const keepedUsersIds = intersection(activePaidUsersIds, selectedUserIds)
            const newAddedUserIds = difference(addedUserIds, paidUsersIds)
            const allUserIds = [...keepedUsersIds, ...addedUserIds, ...removedUserIds]
            return { allUserIds, addedUserIds, removedUserIds, newAddedUserIds }
        }
        return { allUserIds: selectedUserIds, addedUserIds: [], removedUserIds: [], newAddedUserIds: [] }
    }

    const { allUserIds, removedUserIds, newAddedUserIds } = getUserIdsLists(subscription)

    return (
        <table>
            <tr>
                <td style={{ width: smallScreenNavigation ? 100 : 190 }}>
                    {smallScreenNavigation ? (
                        <SelectedUsersTableThHeaderText text1={'Selected'} text2={'users'} />
                    ) : (
                        <Text style={localStyles.header}>{translate('Selected users')}</Text>
                    )}
                </td>
                {!isActiveSubscription &&
                    !isEditingUsersPendingSubscription &&
                    !isCanceledSubscription &&
                    !isActivationPendingSubscription && (
                        <th style={{ textAlign: 'center', width: smallScreenNavigation || isMiddleScreen ? 40 : 70 }} />
                    )}
                {(isActiveSubscription ||
                    isEditingUsersPendingSubscription ||
                    isCanceledSubscription ||
                    isActivationPendingSubscription) && (
                    <SelectedUsersTableTh
                        text1={smallScreenNavigation || isMiddleScreen ? 'Alre' : 'Already'}
                        text2={'paid'}
                    />
                )}
                <SelectedUsersTableTh text1={'New'} text2={'paid'} />
                {(isActiveSubscription || isEditingUsersPendingSubscription) && (
                    <SelectedUsersTableTh
                        text1={smallScreenNavigation || isMiddleScreen ? 'Canc' : 'Canceled'}
                        text2={smallScreenNavigation || isMiddleScreen ? 'pay' : 'payment'}
                    />
                )}
                <SelectedUsersTableTh text1={'Sub'} text2={'Total'} />
            </tr>
            {allUserIds.map(userId => {
                const newPaid = !subscription || newAddedUserIds.includes(userId)
                const canceledPayment = !newPaid && removedUserIds.includes(userId)
                const alreadyPaid = !newPaid && !canceledPayment
                return (
                    <SelectedUsersTableContentItem
                        userId={userId}
                        key={userId}
                        newPaid={newPaid}
                        canceledPayment={canceledPayment}
                        alreadyPaid={alreadyPaid}
                        isActiveSubscription={isActiveSubscription}
                        isEditingUsersPendingSubscription={isEditingUsersPendingSubscription}
                        isCanceledSubscription={isCanceledSubscription}
                        isActivationPendingSubscription={isActivationPendingSubscription}
                        nextPaymentDate={subscription && subscription.nextPaymentDate}
                    />
                )
            })}
        </table>
    )
}

const localStyles = StyleSheet.create({
    header: {
        ...styles.subtitle2,
        color: '#fff',
        marginTop: 22,
    },
})
