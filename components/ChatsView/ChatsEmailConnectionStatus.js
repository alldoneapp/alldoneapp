import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { listEmailConnections } from '../../utils/IntegrationProviders'
import {
    HEALTH_CHECKING,
    HEALTH_RECONNECT_REQUIRED,
    HEALTH_UNKNOWN,
    useConnectionHealth,
} from '../SettingsView/Integrations/useConnectionHealth'

export default function ChatsEmailConnectionStatus() {
    const loggedUser = useSelector(state => state.loggedUser)
    const connections = listEmailConnections(loggedUser)
    const connectionIds = connections.map(connection => connection.connectionId)
    const { healthByConnectionId } = useConnectionHealth(connectionIds)

    if (connections.length === 0) return null

    const statuses = connectionIds.map(id => healthByConnectionId[id]?.status)
    // The first render precedes the hook's effect, so a missing result is also pending.
    const checking = statuses.some(status => !status || status === HEALTH_CHECKING)
    const reconnectRequired =
        connections.some(connection => connection.authInvalid === true) || statuses.includes(HEALTH_RECONNECT_REQUIRED)
    const unknown = statuses.includes(HEALTH_UNKNOWN)

    // Once every account is verified, the banner disappears; a failed request never
    // looks "connected".
    if (!checking && !reconnectRequired && !unknown) return null

    const message = checking
        ? translate('Checking email connections')
        : reconnectRequired
          ? translate('Reconnect email in Settings > Integrations')
          : translate('Could not verify email connections')
    const color = reconnectRequired && !checking ? colors.UtilityRed200 : colors.Text02

    return (
        <View
            style={localStyles.container}
            testID="chats-email-connection-status"
            accessibilityLabel={message}
            accessibilityLiveRegion="polite"
        >
            {checking ? (
                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.icon} />
            ) : (
                <Icon name="alert-circle" size={16} color={color} style={localStyles.icon} />
            )}
            <Text style={[styles.caption1, { color }]}>{message}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 32,
        marginVertical: 8,
    },
    icon: {
        marginRight: 8,
    },
})
