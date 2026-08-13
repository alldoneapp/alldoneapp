import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    formatAssistantModelTokensPerGold,
    getAssistantModelTokensPerGold,
} from '../../functions/Assistant/selectableAssistantModels'

export function getAssistantModelGoldRateText({ model, tokensPerGold } = {}) {
    const resolvedTokens = tokensPerGold || getAssistantModelTokensPerGold(model)
    const formattedTokens = formatAssistantModelTokensPerGold(resolvedTokens)
    if (!formattedTokens) return ''

    return translate('1 Gold = %{tokens} tokens', { tokens: formattedTokens })
}

export default function AssistantModelGoldRate({ model, tokensPerGold, style }) {
    const text = getAssistantModelGoldRateText({ model, tokensPerGold })
    if (!text) return null

    return <Text style={[localStyles.rate, style]}>{text}</Text>
}

const localStyles = StyleSheet.create({
    rate: {
        ...styles.caption1,
        color: colors.Yellow400,
        marginTop: 2,
    },
})
