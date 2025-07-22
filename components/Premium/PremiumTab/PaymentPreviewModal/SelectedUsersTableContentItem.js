import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { getDaysLeftUntilNextPaymentPercent, NET_PRICE } from '../../PremiumHelper'
import Icon from '../../../Icon'
import Avatar from '../../../Avatar'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'
import { getUserData } from '../../../../utils/backends/Users/usersFirestore'

export default function SelectedUsersTableContentItem({
    userId,
    newPaid,
    canceledPayment,
    alreadyPaid,
    isActiveSubscription,
    isEditingUsersPendingSubscription,
    isCanceledSubscription,
    isActivationPendingSubscription,
    nextPaymentDate,
}) {
    const [user, setUser] = useState(null)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const updateUser = async () => {
        let user = TasksHelper.getUser(userId)
        user = user ? user : await getUserData(userId, false)
        user = user ? user : { displayName: 'Removed user' }
        setUser(user)
    }

    useEffect(() => {
        updateUser()
    }, [userId])

    const displayName = user ? user.displayName : 'Loading user...'
    const photoURL = user ? user.photoURL : ''
    const name = HelperFunctions.getFNameFLastN(displayName)

    return (
        <tr>
            <td style={{ width: !smallScreenNavigation ? 190 : 100 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
                    <Avatar
                        avatarId={userId}
                        reviewerPhotoURL={photoURL}
                        size={32}
                        borderSize={0}
                        externalStyle={{ marginRight: 8 }}
                    />
                    <Text style={localStyles.userName}>{name}</Text>
                </View>
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
                <th style={{ textAlign: 'center' }}>
                    {alreadyPaid && <Icon name="check" color={colors.Text03} size={24} />}
                </th>
            )}
            <th style={{ textAlign: 'center' }}>{newPaid && <Icon name="check" color={colors.Text03} size={24} />}</th>
            {(isActiveSubscription || isEditingUsersPendingSubscription) && (
                <th style={{ textAlign: 'center' }}>
                    {canceledPayment && <Icon name="check" color={colors.Text03} size={24} />}
                </th>
            )}
            <th style={{ textAlign: 'center' }}>
                <Text style={localStyles.subTotal}>
                    {isActiveSubscription ||
                    isEditingUsersPendingSubscription ||
                    isCanceledSubscription ||
                    isActivationPendingSubscription
                        ? canceledPayment || alreadyPaid
                            ? '-'
                            : `${(getDaysLeftUntilNextPaymentPercent(nextPaymentDate) * NET_PRICE).toFixed(
                                  smallScreenNavigation || isMiddleScreen ? 1 : 2
                              )} €`
                        : `${NET_PRICE} €`}
                </Text>
            </th>
        </tr>
    )
}

const localStyles = StyleSheet.create({
    userName: {
        ...styles.subtitle1,
        color: '#fff',
    },
    subTotal: {
        ...styles.body1,
        color: '#fff',
    },
})
