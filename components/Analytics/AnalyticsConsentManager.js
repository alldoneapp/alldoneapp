import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { updateUserDataDirectly } from '../../utils/backends/Users/usersFirestore'
import {
    ANALYTICS_CONSENT_CHANGED_EVENT,
    ANALYTICS_CONSENT_DENIED,
    ANALYTICS_CONSENT_DIALOG_EVENT,
    ANALYTICS_CONSENT_GRANTED,
    ANALYTICS_CONSENT_UNKNOWN,
    getAnalyticsClientId,
    getAnalyticsConsent,
    getAnalyticsConsentRecord,
    initializeAnalytics,
    isAnalyticsEnabled,
    setAnalyticsConsent,
    setAnalyticsUser,
    trackPageView,
} from '../../utils/analytics/analytics'

export default function AnalyticsConsentManager() {
    const loggedUser = useSelector(state => state.loggedUser)
    const navigationRoute = useSelector(state => state.route)
    const smallScreen = useSelector(state => state.smallScreen)
    const [consent, setConsent] = useState(getAnalyticsConsent())
    const [dialogOpen, setDialogOpen] = useState(consent === ANALYTICS_CONSENT_UNKNOWN)

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        initializeAnalytics()

        const onConsentChanged = event => {
            setConsent(event.detail.status)
            setDialogOpen(false)
        }
        const onDialogRequested = () => setDialogOpen(true)

        window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged)
        window.addEventListener(ANALYTICS_CONSENT_DIALOG_EVENT, onDialogRequested)
        return () => {
            window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged)
            window.removeEventListener(ANALYTICS_CONSENT_DIALOG_EVENT, onDialogRequested)
        }
    }, [])

    useEffect(() => {
        const userId = loggedUser?.uid && !loggedUser.isAnonymous ? loggedUser.uid : null
        setAnalyticsUser(userId)
        if (consent === ANALYTICS_CONSENT_GRANTED && navigationRoute) trackPageView(navigationRoute)
    }, [consent, navigationRoute, loggedUser?.uid, loggedUser?.isAnonymous])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        let canceled = false

        const syncAnalyticsUser = async () => {
            const userId = loggedUser?.uid
            if (!userId || loggedUser.isAnonymous) return

            if (consent === ANALYTICS_CONSENT_UNKNOWN) return

            const consentRecord = getAnalyticsConsentRecord()
            const clientId = consent === ANALYTICS_CONSENT_GRANTED ? await getAnalyticsClientId() : null
            if (canceled) return

            await updateUserDataDirectly(
                userId,
                {
                    analytics: {
                        ...(consent === ANALYTICS_CONSENT_GRANTED ? loggedUser.analytics || {} : {}),
                        consent,
                        consentVersion: consentRecord.version,
                        consentUpdatedAt: consentRecord.updatedAt,
                        ...(clientId ? { clientId } : {}),
                    },
                },
                null
            )
        }

        syncAnalyticsUser().catch(error => console.warn('Failed to synchronize analytics consent:', error))
        return () => {
            canceled = true
        }
    }, [consent, loggedUser?.uid, loggedUser?.isAnonymous])

    if (!isAnalyticsEnabled() || !dialogOpen) return null

    return (
        <View pointerEvents="box-none" style={localStyles.overlay} testID="analytics-consent-banner">
            <View style={[localStyles.banner, smallScreen && localStyles.mobileBanner]}>
                <View style={[localStyles.copy, smallScreen && localStyles.mobileCopy]}>
                    <Text style={[styles.subtitle1, localStyles.title]}>{translate('Analytics consent title')}</Text>
                    <Text style={[styles.body2, localStyles.description]}>
                        {translate('Analytics consent description')}{' '}
                        <a href="https://alldone.app/privacy" target="_blank" style={localStyles.link}>
                            {translate('Privacy')}
                        </a>
                    </Text>
                </View>
                <View style={[localStyles.actions, smallScreen && localStyles.mobileActions]}>
                    <TouchableOpacity
                        accessibilityRole="button"
                        style={[localStyles.button, localStyles.secondaryButton]}
                        onPress={() => setAnalyticsConsent(ANALYTICS_CONSENT_DENIED)}
                    >
                        <Text style={[styles.subtitle2, localStyles.secondaryButtonText]}>
                            {translate('Necessary only')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        style={[localStyles.button, localStyles.primaryButton]}
                        onPress={() => setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)}
                    >
                        <Text style={[styles.subtitle2, localStyles.primaryButtonText]}>
                            {translate('Allow analytics')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100000,
        padding: 16,
        alignItems: 'center',
    },
    banner: {
        width: '100%',
        maxWidth: 960,
        padding: 20,
        borderRadius: 12,
        backgroundColor: '#FFFFFF',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    copy: {
        flex: 1,
        paddingRight: 24,
    },
    mobileBanner: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    mobileCopy: {
        paddingRight: 0,
        paddingBottom: 16,
    },
    title: {
        color: colors.Text01,
        marginBottom: 6,
    },
    description: {
        color: colors.Text03,
    },
    link: {
        color: colors.Primary100,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    mobileActions: {
        justifyContent: 'flex-end',
    },
    button: {
        minHeight: 44,
        paddingHorizontal: 18,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    secondaryButton: {
        borderWidth: 1,
        borderColor: colors.Primary100,
        backgroundColor: '#FFFFFF',
    },
    primaryButton: {
        backgroundColor: colors.Primary100,
    },
    secondaryButtonText: {
        color: colors.Primary100,
    },
    primaryButtonText: {
        color: '#FFFFFF',
    },
})
