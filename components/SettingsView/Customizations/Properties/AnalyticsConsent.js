import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import {
    ANALYTICS_CONSENT_CHANGED_EVENT,
    ANALYTICS_CONSENT_DENIED,
    ANALYTICS_CONSENT_GRANTED,
    getAnalyticsConsent,
    isAnalyticsEnabled,
    setAnalyticsConsent,
} from '../../../../utils/analytics/analytics'

export default function AnalyticsConsent() {
    const [consent, setConsent] = useState(getAnalyticsConsent())

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onConsentChanged = event => setConsent(event.detail.status)
        window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged)
        return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged)
    }, [])

    if (!isAnalyticsEnabled()) return null

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'lock'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <View style={localStyles.copy}>
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                        {translate('Analytics and privacy')}
                    </Text>
                    <Text style={[styles.caption2, { color: colors.Text03 }]}>
                        {consent === ANALYTICS_CONSENT_GRANTED
                            ? translate('Analytics enabled')
                            : translate('Analytics disabled')}
                    </Text>
                </View>
            </View>
            <View style={localStyles.actions}>
                <TouchableOpacity
                    style={[localStyles.button, consent === ANALYTICS_CONSENT_DENIED && localStyles.selectedButton]}
                    onPress={() => setAnalyticsConsent(ANALYTICS_CONSENT_DENIED)}
                >
                    <Text style={styles.caption1}>{translate('Necessary only')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[localStyles.button, consent === ANALYTICS_CONSENT_GRANTED && localStyles.selectedButton]}
                    onPress={() => setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)}
                >
                    <Text style={styles.caption1}>{translate('Allow analytics')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        minHeight: 72,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
    },
    copy: {
        flex: 1,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    button: {
        minHeight: 36,
        paddingHorizontal: 12,
        marginLeft: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectedButton: {
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue100,
    },
})
