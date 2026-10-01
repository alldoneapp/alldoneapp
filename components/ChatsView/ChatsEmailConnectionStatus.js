import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { listEmailConnections } from '../../utils/IntegrationProviders'
import NavigationService from '../../utils/NavigationService'
import SettingsHelper from '../SettingsView/SettingsHelper'
import URLsSettings, { URL_SETTINGS_INTEGRATIONS } from '../../URLSystem/Settings/URLsSettings'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../utils/TabNavigationConstants'
import { useEmailCheckCadence } from './useEmailCheckCadence'
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

    const statuses = connectionIds.map(id => healthByConnectionId[id]?.status)
    // The first render precedes the hook's effect, so a missing result is also pending.
    const checking = statuses.some(status => !status || status === HEALTH_CHECKING)
    const reconnectRequired =
        connections.some(connection => connection.authInvalid === true) || statuses.includes(HEALTH_RECONNECT_REQUIRED)
    const unknown = statuses.includes(HEALTH_UNKNOWN)
    const visible = connections.length > 0 && (checking || reconnectRequired || unknown)
    const cadences = useEmailCheckCadence(loggedUser, visible ? connections : [])

    // Once every account is verified, the banner disappears; a failed request never
    // looks "connected".
    if (!visible) return null

    const message = checking
        ? translate('Checking email connections')
        : reconnectRequired
          ? translate('Reconnect email in Settings > Integrations')
          : translate('Could not verify email connections')
    const color = reconnectRequired && !checking ? colors.UtilityRed200 : colors.Text02
    const cadenceMessages = connections.map((connection, index) => {
        const cadence = cadences[index]
        const broken =
            connection.authInvalid ||
            healthByConnectionId[connection.connectionId]?.status === HEALTH_RECONNECT_REQUIRED
        const key = broken
            ? 'Background email checks paused until reconnect'
            : {
                  enabled: 'Background email checks every minutes',
                  disabled: 'Background email checks disabled',
                  unconfigured: 'Background email checks not configured',
                  loading: 'Loading background email check settings',
                  unknown: 'Background email check settings unavailable',
                  unsupported: 'Background email checks unsupported',
                  premium_required: 'Background email checks require Premium',
              }[cadence.status]
        const text = translate(key, { minutes: cadence.minutes })
        return connections.length > 1 ? `${connection.email}: ${text}` : text
    })
    const settingsLabel = `${translate('Settings')} → ${translate('Integrations')}`
    const fullMessage = [message, ...cadenceMessages, settingsLabel].join(' · ')

    return (
        <View
            style={localStyles.container}
            testID="chats-email-connection-status"
            accessibilityLabel={fullMessage}
            accessibilityLiveRegion="polite"
        >
            {checking ? (
                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.icon} />
            ) : (
                <Icon name="alert-circle" size={16} color={color} style={localStyles.icon} />
            )}
            <Text style={[styles.caption1, localStyles.message, { color }]}>
                {[message, ...cadenceMessages].join(' · ')}
                {' · '}
                <Text
                    style={localStyles.link}
                    accessibilityRole="link"
                    href={`/${URLsSettings.getPath(URL_SETTINGS_INTEGRATIONS)}`}
                    onPress={event => {
                        if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return
                        event?.preventDefault?.()
                        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
                    }}
                >
                    {settingsLabel}
                </Text>
            </Text>
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
    message: {
        flex: 1,
        minWidth: 0,
    },
    link: {
        color: colors.Primary100,
        textDecorationLine: 'underline',
    },
})
