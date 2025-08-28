import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { PRICE } from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PaymentInfo({ usersAmount, containerStyle }) {
    const text = `${usersAmount} ${translate(usersAmount === 1 ? 'user' : 'users')} ${translate(
        usersAmount === 1 ? 'selectedSingular' : 'selectedPlural'
    )}. ${translate('Monthly payment EUR', { price: usersAmount * PRICE })}`
    return (
        <View style={[localStyles.container, containerStyle]}>
            <Icon name={'info'} size={16} color={colors.Green400} style={{ marginRight: 8 }} />
            <Text style={localStyles.text}>{text}</Text>
        </View>
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
