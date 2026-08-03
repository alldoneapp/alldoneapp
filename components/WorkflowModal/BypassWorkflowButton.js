import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function BypassWorkflowButton({ disabled, onPress }) {
    return (
        <TouchableOpacity
            testID="bypass-workflow-button"
            style={localStyles.button}
            disabled={disabled}
            onPress={onPress}
            accessibilityLabel={translate('Bypass workflow')}
        >
            <Text style={[localStyles.text, disabled && localStyles.disabledText]}>{translate('Bypass workflow')}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignSelf: 'center',
        marginTop: -8,
        marginBottom: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    text: {
        ...styles.buttonLabel,
        fontFamily: 'Roboto-Regular',
        color: colors.Text03,
    },
    disabledText: {
        color: colors.Text04,
    },
})
