import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import UserTag from '../RemoveSelectedUserModal/UserTag'
import {
    removePaidUsersFromSubscription,
    updateUserIdsInSubscription,
} from '../../../../utils/backends/Premium/premiumFirestore'
import { getSubscriptionStatus } from '../../PremiumHelper'

export default function SelectedUsersArea({ selectedUserIds, setSelectedUsersIds, subscription }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const {
        isPendingSubscription,
        isEditingUsersPendingSubscription,
        isActiveSubscription,
        isActivationPendingSubscription,
        isUpdateCreditCardPendingSubscription,
    } = getSubscriptionStatus(subscription)
    const hideRemoveButton =
        isPendingSubscription ||
        isEditingUsersPendingSubscription ||
        isActivationPendingSubscription ||
        isUpdateCreditCardPendingSubscription

    const removerUser = userId => {
        const userIds = selectedUserIds.filter(id => id !== userId)
        if (subscription) {
            updateUserIdsInSubscription(userIds)
            if (isActiveSubscription) {
                removePaidUsersFromSubscription({ userPayingId: loggedUserId, removedUserIds: [userId] })
            }
        } else {
            setSelectedUsersIds(userIds)
        }
    }

    return (
        <>
            <Text style={localStyles.headerText}>{translate('Selected users to be under premium subscription')}</Text>
            <View style={localStyles.container}>
                {selectedUserIds.map(userId => (
                    <UserTag
                        key={userId}
                        userId={userId}
                        onPress={() => {
                            removerUser(userId)
                        }}
                        hideRemoveButton={hideRemoveButton}
                    />
                ))}
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    headerText: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginTop: 32,
        marginBottom: 4,
    },
})
