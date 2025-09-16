import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import ToolsAccessWrapper from './ToolsAccessWrapper'
import { TOOL_LABEL_BY_KEY, TOOL_OPTIONS } from './toolOptions'

export default function ToolsAccessProperty({ disabled, projectId, assistant }) {
    const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []

    const summaryText = !allowedTools.length
        ? translate('No tools enabled')
        : allowedTools.length === TOOL_OPTIONS.length
        ? translate('All tools enabled')
        : allowedTools.map(key => translate(TOOL_LABEL_BY_KEY[key] || key)).join(', ')

    return (
        <View style={localStyles.container}>
            <Icon name="tool" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('Allowed tools')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <ToolsAccessWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    textContainer: {
        flexShrink: 1,
        flexGrow: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    summary: {
        ...styles.caption2,
        color: colors.Text04,
    },
})
