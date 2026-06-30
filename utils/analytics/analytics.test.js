/** @jest-environment jsdom */

jest.mock('./analyticsConfig', () => ({
    ANALYTICS_ENABLED: true,
    GOOGLE_ANALYTICS_KEY: 'G-HR3PWMHKQQ',
}))

import {
    ANALYTICS_CONSENT_DENIED,
    ANALYTICS_CONSENT_GRANTED,
    GOOGLE_ANALYTICS_KEY,
    __resetAnalyticsForTests,
    __setAnalyticsEnabledForTests,
    getAnalyticsConsent,
    isAnalyticsEnabled,
    setAnalyticsConsent,
    setAnalyticsUser,
    trackEvent,
    trackPageView,
} from './analytics'

const getDataLayerCalls = () => (window.dataLayer || []).map(args => Array.from(args))

describe('analytics', () => {
    beforeEach(() => {
        document.head.innerHTML = ''
        document.cookie = '_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
        window.localStorage.clear()
        delete window.dataLayer
        delete window.gtag
        delete window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`]
        __resetAnalyticsForTests()
        __setAnalyticsEnabledForTests(true)
    })

    test('does not load or send analytics before consent', () => {
        expect(trackEvent('login', { method: 'google' })).toBe(false)
        expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0)
        expect(window.dataLayer).toBeUndefined()
    })

    test('stays disabled outside the production hostname', () => {
        __setAnalyticsEnabledForTests(null)

        expect(window.location.hostname).toBe('localhost')
        expect(isAnalyticsEnabled()).toBe(false)
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0)
    })

    test('loads the Google tag exactly once after consent', () => {
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)

        const scripts = document.querySelectorAll('script[src*="googletagmanager.com"]')
        expect(scripts).toHaveLength(1)
        expect(scripts[0].src).toContain(GOOGLE_ANALYTICS_KEY)
        expect(getAnalyticsConsent()).toBe(ANALYTICS_CONSENT_GRANTED)

        const configCall = getDataLayerCalls().find(call => call[0] === 'config')
        expect(configCall[1]).toBe(GOOGLE_ANALYTICS_KEY)
        expect(configCall[2]).toMatchObject({ send_page_view: false })
    })

    test('normalizes legacy events and removes PII parameters', () => {
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        trackEvent('new_user', { id: 'internal-id', email: 'person@example.com' })

        const eventCall = getDataLayerCalls().find(call => call[0] === 'event' && call[1] === 'sign_up')
        expect(eventCall).toEqual(['event', 'sign_up', { method: 'google' }])
    })

    test('deduplicates page views and sends only stable route paths', () => {
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)

        expect(trackPageView('TaskDetailedView')).toBe(true)
        expect(trackPageView('TaskDetailedView')).toBe(false)

        const pageViews = getDataLayerCalls().filter(call => call[0] === 'event' && call[1] === 'page_view')
        expect(pageViews).toHaveLength(1)
        expect(pageViews[0][2]).toMatchObject({
            page_path: '/app/tasks/detail',
            page_location: 'https://my.alldone.app/app/tasks/detail',
        })

        expect(trackPageView('TaskDetailedView/private-object-id?email=person@example.com')).toBe(true)
        const unknownRoutePageView = getDataLayerCalls().filter(
            call => call[0] === 'event' && call[1] === 'page_view'
        )[1]
        expect(unknownRoutePageView[2]).toMatchObject({
            page_title: 'Alldone - App',
            page_path: '/app/other',
            page_location: 'https://my.alldone.app/app/other',
        })
        expect(JSON.stringify(unknownRoutePageView)).not.toContain('private-object-id')
        expect(JSON.stringify(unknownRoutePageView)).not.toContain('person@example.com')
    })

    test('denial disables analytics and prevents later events', () => {
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        document.cookie = '_ga=test-client-id; path=/'
        document.cookie = '_ga_HR3PWMHKQQ=test-session; path=/'
        setAnalyticsConsent(ANALYTICS_CONSENT_DENIED)

        expect(window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`]).toBe(true)
        expect(getAnalyticsConsent()).toBe(ANALYTICS_CONSENT_DENIED)
        expect(document.cookie).not.toContain('_ga')
        expect(trackEvent('login', { method: 'google' })).toBe(false)

        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        expect(window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`]).toBe(false)
        expect(trackEvent('login', { method: 'google' })).toBe(true)
    })

    test('sets and clears the pseudonymous GA4 user ID', () => {
        setAnalyticsConsent(ANALYTICS_CONSENT_GRANTED)
        setAnalyticsUser('firebase-uid')
        setAnalyticsUser(null)

        const configCalls = getDataLayerCalls().filter(call => call[0] === 'config')
        expect(configCalls[configCalls.length - 2][2].user_id).toBe('firebase-uid')
        expect(configCalls[configCalls.length - 1][2].user_id).toBeNull()
    })
})
