import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function PromptArea({ assistantName, generatedPrompt }) {
    return (
        <View style={localStyles.section}>
            <Text style={localStyles.header}>{translate('Output')}</Text>
            <Text style={localStyles.text}>
                {translate('You will get the following prompt to send to', { assistantName })}
            </Text>
            <Text style={localStyles.prompt}>{generatedPrompt}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
    },
    header: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 16,
    },
    text: {
        ...styles.body2,
        color: colors.Grey200,
    },
    prompt: {
        ...styles.body2,
        color: colors.Grey200,
        marginBottom: 16,
    },
})
