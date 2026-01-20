import {
    URL_FEEDS_FOLLOWED,
    URL_FEEDS_NOT_FOLLOWED,
    URL_LOGIN,
    URL_LOGOUT,
    URL_ONBOARDING,
    URL_PAYMENT_SUCCESS,
    URL_PRIVATE_RESOURCE,
    URL_PROJECT_FEEDS_FOLLOWED,
    URL_PROJECT_FEEDS_NOT_FOLLOWED,
    URL_START_TRIAL,
} from './URLSystem'
import SettingsHelper from '../components/SettingsView/SettingsHelper'
import TasksHelper from '../components/TaskListView/Utils/TasksHelper'
import { inProductionEnvironment } from '../utils/backends/firestore'

export const URL_NOT_MATCH = 'NOT_MATCH'

class URLSystemTrigger {
    static getRegexList = () => {
        return {
            [URL_FEEDS_FOLLOWED]: new RegExp('^/updates/followed$'),
            [URL_FEEDS_NOT_FOLLOWED]: new RegExp('^/updates/all$'),
            [URL_PROJECT_FEEDS_FOLLOWED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/updates/followed$'
            ),
            [URL_PROJECT_FEEDS_NOT_FOLLOWED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/updates/all$'
            ),
            [URL_PRIVATE_RESOURCE]: /^\/private-resource$/,
            [URL_LOGOUT]: /^\/logout$/,
            [URL_LOGIN]: /^\/login$/,
            [URL_ONBOARDING]: /^\/onboarding$/,
            [URL_START_TRIAL]: /^\/starttrial(?:\?(.*))?$/,
            [URL_PAYMENT_SUCCESS]: /^\/paymentsuccess$/,
        }
    }

    static match = pathname => {
        const regexList = URLSystemTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLSystemTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_FEEDS_FOLLOWED:
                return SettingsHelper.processURLFeeds(navigation, URL_FEEDS_FOLLOWED)
            case URL_FEEDS_NOT_FOLLOWED:
                return SettingsHelper.processURLFeeds(navigation, URL_FEEDS_NOT_FOLLOWED)
            case URL_PROJECT_FEEDS_FOLLOWED:
                return SettingsHelper.processURLFeeds(
                    navigation,
                    URL_PROJECT_FEEDS_FOLLOWED,
                    params.projectId,
                    params.userId
                )
            case URL_PROJECT_FEEDS_NOT_FOLLOWED:
                return SettingsHelper.processURLFeeds(
                    navigation,
                    URL_PROJECT_FEEDS_NOT_FOLLOWED,
                    params.projectId,
                    params.userId
                )
            case URL_PRIVATE_RESOURCE:
                return SettingsHelper.processURLPrivateResource(navigation)
            case URL_LOGIN:
                // Check if returning from Google Auth
                const urlParams = new URLSearchParams(window.location.search)
                if (urlParams.get('googleAuth') === 'success') {
                    return navigation.navigate('WhatsAppOnboarding')
                }
                return TasksHelper.processURLAllProjectsTasks(navigation)
            case URL_ONBOARDING:
                // Stay on onboarding - also handle Google Auth return
                const onboardingParams = new URLSearchParams(window.location.search)
                if (onboardingParams.get('googleAuth') === 'success') {
                    return navigation.navigate('WhatsAppOnboarding')
                }
                return navigation.navigate('WhatsAppOnboarding')
            case URL_START_TRIAL:
                return URLSystemTrigger.processStartTrial(navigation, pathname)
            case URL_PAYMENT_SUCCESS:
                return SettingsHelper.processURLPaymentSuccess(navigation)
        }
    }

    static processStartTrial = (navigation, pathname) => {
        // Parse query parameters from the pathname parameter
        let planType = 'monthly'

        // Extract query string from pathname
        const queryIndex = pathname.indexOf('?')

        if (queryIndex !== -1) {
            const queryString = pathname.substring(queryIndex + 1)
            const urlParams = new URLSearchParams(queryString)
            planType = urlParams.get('plan') || urlParams.get('type') || 'monthly'
        } else {
            // Fallback to window.location.search if no query params in pathname
            const urlParams = new URLSearchParams(window.location.search)
            planType = urlParams.get('plan') || urlParams.get('type') || 'monthly'
        }

        navigation.navigate('Onboarding', { plan: planType })
    }

    static redirectToStripe = planType => {
        // Generate unique tracking ID for linking subscription to account later
        const trackingId = 'alldone_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)

        // Store tracking ID in localStorage for later account linking
        localStorage.setItem('alldone_trial_tracking_id', trackingId)
        localStorage.setItem('alldone_trial_plan_type', planType)
        localStorage.setItem('alldone_trial_timestamp', Date.now().toString())

        const isProduction = inProductionEnvironment()

        console.log('💾 Storing trial tracking data:', {
            trackingId: trackingId.substring(0, 20) + '...',
            planType,
            timestamp: Date.now(),
            redirecting: isProduction ? 'production' : 'test',
        })

        // Define the redirect URLs based on environment
        let monthlyUrl, yearlyUrl

        if (isProduction) {
            // Production Stripe payment links with tracking
            monthlyUrl = `https://buy.stripe.com/7sY7sLagScKa0OyfOH9Zm0d?client_reference_id=${trackingId}`
            yearlyUrl = `https://buy.stripe.com/00waEXex8h0qdBkaun9Zm0c?client_reference_id=${trackingId}`
        } else {
            // Test Stripe payment links with tracking
            monthlyUrl = `https://buy.stripe.com/test_fZu28rex8fWm1SC7ib9Zm00?client_reference_id=${trackingId}`
            yearlyUrl = `https://buy.stripe.com/test_fZu4gzcp0dOebtceKD9Zm01?client_reference_id=${trackingId}`
        }

        // Redirect based on plan type
        if (planType.toLowerCase() === 'yearly') {
            window.location.href = yearlyUrl
        } else {
            window.location.href = monthlyUrl
        }
    }
}

export default URLSystemTrigger
