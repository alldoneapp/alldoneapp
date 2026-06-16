import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import McpServersAccessWrapper from './McpServersAccessWrapper'

export default function McpServersAccessProperty({ disabled, projectId, assistant }) {
    const servers = Array.isArray(assistant.mcpServers) ? assistant.mcpServers : []
    const enabledCount = servers.filter(s => s && s.enabled !== false).length

    const summaryText = !servers.length
        ? translate('No MCP servers connected')
        : servers.map(s => `${s.label}${s.enabled === false ? ` (${translate('disabled')})` : ''}`).join(', ')

    return (
        <View style={localStyles.container}>
            <Icon name="server" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('MCP servers')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <McpServersAccessWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    serverCount={servers.length}
                    enabledCount={enabledCount}
                />
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
