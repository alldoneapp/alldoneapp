import React from 'react'
import { View, StyleSheet } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'

export default function SetPrivacyButton({ onPress }) {
    return (
        <View style={localStyles.container}>
            <Button title={translate('Set privacy')} type={'primary'} onPress={onPress} shortcutText={'Enter'} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        paddingVertical: 8,
    },
})
