import React, { useEffect } from 'react'
import { KeyboardAvoidingView } from 'react-native'
import { Provider } from 'react-redux'
import * as Sentry from '@sentry/react'
import * as Font from './utils/WebShims/Fonts'

import RobotoMedium from './assets/fonts/Roboto-Medium.ttf'
import RobotoRegular from './assets/fonts/Roboto-Regular.ttf'
import AllDone from './assets/fonts/alldone.ttf'
import './assets/css/GlobalStyles.css'

import store from './redux/store'
import ErrorBoundary from './utils/ErrorBoundary'
import AppContent from './AppContent'
import { getSentryVariables, initTimeProvider } from './utils/backends/firestore'
import HelperFunctions from './utils/HelperFunctions'
import { startDailyAppReload } from './utils/DailyAppReload'
import { installBrowserPerformanceObservers, startNamedPerformanceTrace } from './utils/performance/performanceLogger'
import { installStorePerformanceObserver } from './utils/performance/storePerformanceObserver'

startNamedPerformanceTrace('app_boot', 'app_boot', { source: 'cold_start' })
installStorePerformanceObserver(store)
installBrowserPerformanceObservers()

try {
    const sentryDsn = getSentryVariables().SENTRY_DSN
    if (sentryDsn && sentryDsn.length > 0) {
        Sentry.init({
            dsn: sentryDsn,
        })
    } else {
        console.warn('Sentry DSN is not configured, skipping Sentry initialization')
    }
} catch (error) {
    console.warn('Failed to initialize Sentry:', error)
}

initTimeProvider()

export default function App() {
    const loadFonts = () => {
        Font.loadAsync({
            'Roboto-Medium': { uri: RobotoMedium },
            'Roboto-Regular': { uri: RobotoRegular },
            AllDone: { uri: AllDone },
        })
    }

    useEffect(() => {
        loadFonts()
        HelperFunctions.setRootStyles()
    }, [])

    useEffect(() => startDailyAppReload(), [])

    return (
        <ErrorBoundary>
            <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
                <Provider store={store}>
                    <AppContent />
                </Provider>
            </KeyboardAvoidingView>
        </ErrorBoundary>
    )
}
