import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import AnalyticsConsentManager from './AnalyticsConsentManager'

jest.mock('react-native', () => {
    const reactNative = jest.requireActual('react-native-web')
    return {
        ...reactNative,
        StyleSheet: {
            ...reactNative.StyleSheet,
            create: styles => styles,
            flatten: styles => (Array.isArray(styles) ? Object.assign({}, ...styles.filter(Boolean)) : styles || {}),
        },
        Text: 'Text',
        TouchableOpacity: 'TouchableOpacity',
        View: 'View',
    }
})

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('../../i18n/TranslationService', () => ({
    translate: key => key,
}))

jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    updateUserDataDirectly: jest.fn(),
}))

jest.mock('../../utils/analytics/analytics', () => ({
    ANALYTICS_CONSENT_CHANGED_EVENT: 'alldone:analytics-consent-changed',
    ANALYTICS_CONSENT_DENIED: 'denied',
    ANALYTICS_CONSENT_DIALOG_EVENT: 'alldone:analytics-consent-dialog',
    ANALYTICS_CONSENT_GRANTED: 'granted',
    ANALYTICS_CONSENT_UNKNOWN: 'unknown',
    getAnalyticsClientId: jest.fn(),
    getAnalyticsConsent: () => 'unknown',
    getAnalyticsConsentRecord: () => ({ status: 'unknown', version: 1, updatedAt: null }),
    initializeAnalytics: jest.fn(),
    isAnalyticsEnabled: () => true,
    setAnalyticsConsent: jest.fn(),
    setAnalyticsUser: jest.fn(),
    trackPageView: jest.fn(),
}))

describe('AnalyticsConsentManager responsive layout', () => {
    let tree

    beforeEach(() => {
        useSelector.mockImplementation(selector =>
            selector({ loggedUser: {}, route: 'LoginScreen', smallScreen: false })
        )
    })

    afterEach(() => {
        if (tree) {
            act(() => tree.unmount())
            tree = null
        }
    })

    test('uses the mobile banner layout on an iPhone viewport even before the global breakpoint updates', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390, writable: true })

        await act(async () => {
            tree = renderer.create(<AnalyticsConsentManager />)
        })

        const overlay = tree.root.findByProps({ testID: 'analytics-consent-banner' })
        const bannerStyle = StyleSheet.flatten(overlay.children[0].props.style)

        expect(bannerStyle).toEqual(
            expect.objectContaining({
                flexDirection: 'column',
                alignItems: 'stretch',
            })
        )
    })

    test('responds to viewport resizing without relying on the route wrapper', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200, writable: true })

        await act(async () => {
            tree = renderer.create(<AnalyticsConsentManager />)
        })

        let overlay = tree.root.findByProps({ testID: 'analytics-consent-banner' })
        expect(StyleSheet.flatten(overlay.children[0].props.style).flexDirection).toBe('row')

        act(() => {
            window.innerWidth = 390
            window.dispatchEvent(new Event('resize'))
        })

        overlay = tree.root.findByProps({ testID: 'analytics-consent-banner' })
        expect(StyleSheet.flatten(overlay.children[0].props.style).flexDirection).toBe('column')
    })
})
