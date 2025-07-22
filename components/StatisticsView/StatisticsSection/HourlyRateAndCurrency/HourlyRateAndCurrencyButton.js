import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function HourlyRateAndCurrencyButton({ currency, openModal }) {
    return (
        <View style={localStyles.propertyRow}>
            <View style={localStyles.title}>
                <Icon name={'credit-card'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                    {translate('Hourly rate and currency')}
                </Text>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <Button type={'ghost'} onPress={openModal} title={currency} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    title: { justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 },
})
