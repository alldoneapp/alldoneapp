import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import ConnectionStatusModal from './ConnectionStatusModal'
import {
    CONNECTION_HEALTH_LIVE,
    CONNECTION_HEALTH_OFFLINE,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_SLOW,
    CONNECTION_HEALTH_STALE,
} from '../../utils/connectionHealth'
import { translate } from '../../i18n/TranslationService'

/**
 * The visible half of connection health (PT-4660).
 *
 * Renders NOTHING while the connection is live, which is the overwhelming majority
 * of the time — a status indicator that is always on screen is one nobody reads,
 * and the app should not spend permanent top-bar real estate telling the user that
 * everything is normal. It appears only when the app has something honest to say.
 *
 * Tapping it opens the explanation and the manual reconnect, so the user never has
 * to reload the page to recover — a reload costs every open editor, scroll position
 * and modal in the session.
 */
export const CONNECTION_CHIP_PRESENTATION = {
    [CONNECTION_HEALTH_SLOW]: {
        icon: 'clock',
        color: colors.UtilityYellow200,
        label: 'Slow connection',
    },
    [CONNECTION_HEALTH_RECONNECTING]: {
        icon: 'refresh-cw',
        color: colors.UtilityYellow200,
        label: 'Reconnecting',
    },
    [CONNECTION_HEALTH_STALE]: {
        icon: 'alert-triangle',
        color: colors.UtilityYellow200,
        label: 'Not up to date',
    },
    [CONNECTION_HEALTH_OFFLINE]: {
        icon: 'cloud-off',
        color: colors.UtilityRed200,
        label: 'Offline',
    },
}

export default function ConnectionStatusChip({ mobile = false }) {
    const connectionHealth = useSelector(state => state.connectionHealth)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const presentation = CONNECTION_CHIP_PRESENTATION[connectionHealth]
    // Live (and any unknown future state) is silent by design.
    if (!presentation || connectionHealth === CONNECTION_HEALTH_LIVE) return null

    const chip = (
        <AppPopover
            isOpen={isOpen}
            onClickOutside={() => setIsOpen(false)}
            align={'end'}
            position={['bottom', 'left']}
            content={<ConnectionStatusModal connectionHealth={connectionHealth} closeModal={() => setIsOpen(false)} />}
        >
            <TouchableOpacity
                style={[localStyles.chip, mobile && localStyles.mobileChip]}
                onPress={() => setIsOpen(open => !open)}
                accessibilityLabel={translate(presentation.label)}
                testID={`connection-status-chip-${connectionHealth}`}
            >
                <Icon name={presentation.icon} size={20} color={presentation.color} />
                {(mobile || !smallScreenNavigation) && (
                    <Text style={[localStyles.label, { color: presentation.color }]} numberOfLines={1}>
                        {translate(presentation.label)}
                    </Text>
                )}
            </TouchableOpacity>
        </AppPopover>
    )

    if (!mobile) return chip

    return (
        <View style={localStyles.mobileContainer} testID={'mobile-connection-status-container'}>
            {chip}
        </View>
    )
}

const localStyles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        paddingHorizontal: 8,
        borderRadius: 14,
        marginLeft: 16,
        backgroundColor: colors.Grey300,
    },
    label: {
        ...styles.subtitle2,
        marginLeft: 6,
    },
    mobileChip: {
        alignSelf: 'center',
        marginLeft: 0,
    },
    mobileContainer: {
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 4,
        paddingHorizontal: 16,
    },
})
