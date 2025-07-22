import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { PRICE } from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'
import { difference } from 'lodash'

export default function PaymentInfoActive({ subscription }) {
    const { selectedUserIds, activePaidUsersIds } = subscription
    const addedUsersAmount = difference(selectedUserIds, activePaidUsersIds).length
    const removedUsersAmount = difference(activePaidUsersIds, selectedUserIds).length
    const addedUsersText = `${addedUsersAmount} ${translate(addedUsersAmount === 1 ? 'user' : 'users')} ${translate(
        addedUsersAmount === 1 ? 'addedSingular' : 'addedPlural'
    )}. ${translate('Monthly payment increased EUR', {
        price: addedUsersAmount * PRICE,
    })}`
    const removedUsersText = `${removedUsersAmount} ${translate(
        removedUsersAmount === 1 ? 'user' : 'users'
    )} ${translate(
        removedUsersAmount === 1 ? 'removedSingular' : 'removedPlural'
    )}. ${translate('Monthly payment reduced EUR', { price: removedUsersAmount * PRICE })}`
    return (
        <>
            {addedUsersAmount > 0 && (
                <View style={localStyles.container}>
                    <Icon name={'info'} size={16} color={colors.Green400} style={{ marginRight: 8 }} />
                    <Text style={localStyles.text}>{addedUsersText}</Text>
                </View>
            )}
            {removedUsersAmount > 0 && (
                <View style={localStyles.container}>
                    <Icon name={'info'} size={16} color={colors.Green400} style={{ marginRight: 8 }} />
                    <Text style={localStyles.text}>{removedUsersText}</Text>
                </View>
            )}
        </>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.body2,
        color: colors.Green400,
    },
})
