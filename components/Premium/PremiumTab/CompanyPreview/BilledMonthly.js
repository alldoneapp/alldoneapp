import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { PRICE } from '../../PremiumHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function BilledMonthly({ selectedUsersAmount }) {
    return (
        <View style={localStyles.container}>
            <Icon name={'rotate-cw'} size={20} color={colors.Primary200} style={{ marginRight: 8 }} />
            <Text style={localStyles.text}>
                {translate('Billed monthly')} {selectedUsersAmount * PRICE} €
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        backgroundColor: colors.UtilityBlue112,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Primary200,
    },
})
