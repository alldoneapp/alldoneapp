import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function BypassWorkflowButton({ disabled, onPress, label = 'Bypass workflow and mark done' }) {
    const text = translate(label)

    return (
        <TouchableOpacity
            testID="bypass-workflow-button"
            style={localStyles.button}
            disabled={disabled}
            onPress={onPress}
            accessibilityLabel={text}
        >
            <Text style={[localStyles.text, disabled && localStyles.disabledText]}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignSelf: 'center',
        // 8pt of separation from the primary button row above (which contributes its own
        // 16px bottom padding), so the secondary escape hatch reads as a separate action
        // rather than a caption of the blue button (AT-2354).
        marginTop: 8,
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
