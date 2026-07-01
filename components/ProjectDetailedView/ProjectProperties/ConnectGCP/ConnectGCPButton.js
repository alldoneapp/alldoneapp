import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function ConnectGCPButton({ disabled, connected, onPress }) {
    return (
        <View style={localStyles.propertyRow}>
            <View style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name={'cloud'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Connect Google Cloud')}</Text>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <Button
                    icon={connected ? null : 'link'}
                    title={translate(connected ? 'Connected' : 'Connect')}
                    type={'ghost'}
                    onPress={onPress}
                    disabled={disabled}
                />
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
})
