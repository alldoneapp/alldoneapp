import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'

import { LogOut } from './redux/actions'
import store from './redux/store'
import LoadingScreen from './components/LoadingScreen'
import ProgressiveLoadingScreen from './components/ProgressiveLoadingScreen'
import Backend from './utils/BackendBridge'
import NavigationService from './utils/NavigationService'
import GlobalModalsContainerApp from './components/UIComponents/GlobalModalsContainerApp'
import { deleteCacheAndRefresh } from './utils/Observers'
import SharedHelper from './utils/SharedHelper'
import { initIpRegistry } from './utils/Geolocation/GeolocationHelper'
import InitLoadView from './components/InitLoadView/InitLoadView'
import InFocusTaskWatcher from './components/InitLoadView/InFocusTaskWatcher'
import { processNewUser } from './utils/InitialLoad/newUserHelper'
import { loadGlobalDataAndGetUser, loadInitialDataForLoggedUser } from './utils/InitialLoad/loggedUserHelper'
import { AppContainer } from './AppNavigator'
import { unwatch } from './utils/backends/firestore'
import Shortcuts from './components/UIComponents/ShortcutCheatSheet/Shortcuts'
import EndDayStatisticsModal from './components/UIComponents/FloatModals/EndDayStatisticsModal'
import MyDayTasksLoaders from './components/MyDayView/MyDayLoaders/MyDayTasksLoaders'
import { getConnectingMessage } from './utils/FunnyLoadingMessages'

export default function AppContent() {
    const loggedIn = useSelector(state => state.loggedIn)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const loadingStep = useSelector(state => state.loadingStep)
    const loadingMessage = useSelector(state => state.loadingMessage)
    const [heavyComponentsLoaded, setHeavyComponentsLoaded] = useState(false)
    const [connectingMessage] = useState(() => getConnectingMessage())

    const logoutUser = async () => {
        store.dispatch(LogOut())
        await SharedHelper.processUrlAsAnonymous()
    }

    const handleMissingUserDocument = async firebaseUser => {
        const { uid: userId, email } = firebaseUser
        console.warn('INCONSISTENT STATE: Firebase Auth user exists but Firestore user document is missing')
        console.warn('User ID:', userId, 'Email:', email)
        console.log('Attempting to recover by creating missing user document...')

        try {
            // Try to create the user properly as if it's a new signup
            await processNewUser(firebaseUser)
            console.log('✅ Successfully recovered user account')
            return true
        } catch (error) {
            console.error('❌ Failed to recover user account:', error)

            // Show error dialog with options
            const userChoice = confirm(
                `Your account is in an inconsistent state and automatic recovery failed.\n\n` +
                    `Error: ${error.message || 'Unknown error'}\n\n` +
                    `Would you like to:\n` +
                    `• Click OK to delete your authentication and start fresh\n` +
                    `• Click Cancel to try logging in again later\n\n` +
                    `If this problem persists, please contact support with your email: ${email}`
            )

            if (userChoice) {
                // User chose to delete auth and start fresh
                try {
                    console.log('User chose to delete auth - attempting to delete Firebase Auth user...')
                    await firebaseUser.delete()
                    console.log('✅ Firebase Auth user deleted successfully')
                    alert(
                        'Your authentication has been reset. You can now sign up again with a fresh account.\n\n' +
                            'If you had important data, please contact support.'
                    )
                } catch (deleteError) {
                    console.error('Failed to delete Firebase Auth user:', deleteError)
                    // If delete fails, at least sign them out
                    await Backend.auth().signOut()
                    alert(
                        'Could not delete your authentication. You have been logged out.\n\n' +
                            'Please contact support with your email: ' +
                            email
                    )
                }
            } else {
                // User chose to try again later
                await Backend.auth().signOut()
                alert(
                    'You have been logged out. Please try logging in again or contact support if the problem persists.'
                )
            }

            return false
        }
    }

    const tryLogIn = async (firebaseUser, wait) => {
        const { registeredNewUser } = store.getState()
        const { uid: userId } = firebaseUser

        if (registeredNewUser) {
            await processNewUser(firebaseUser)
        } else {
            try {
                const user = await loadGlobalDataAndGetUser(userId)

                if (user) {
                    await loadInitialDataForLoggedUser(user)
                } else if (wait > 0) {
                    setTimeout(() => {
                        tryLogIn(firebaseUser, 0)
                    }, wait)
                } else {
                    // User document doesn't exist in Firestore - try to recover
                    await handleMissingUserDocument(firebaseUser)
                }
            } catch (error) {
                console.error('Error during login:', error)
                alert(
                    `An error occurred during login: ${error.message || 'Unknown error'}\n\n` +
                        'You will be logged out. Please try again or contact support.'
                )
                await Backend.auth().signOut()
            }
        }
    }

    const onInitFirabase = async firebaseUser => {
        if (firebaseUser && !firebaseUser.isAnonymous) {
            await tryLogIn(firebaseUser, 0)
        } else {
            await logoutUser()
        }
    }

    const initFirebase = async () => {
        Backend.initFirebase(async firebaseUser => {
            await onInitFirabase(firebaseUser)
            window.onpopstate = SharedHelper.onHistoryPop
        })
    }

    useEffect(() => {
        initFirebase()
        // Initialize IP registry in background after Firebase auth
        setTimeout(() => {
            initIpRegistry()
        }, 100)
        return () => {
            unwatch('userProjectWatcherUnsubKey')
        }
    }, [])

    // Defer loading of heavy components for better initial performance
    useEffect(() => {
        if (loggedIn && processedInitialURL) {
            // Delay mounting heavy components by 100ms to allow UI to render first
            const timer = setTimeout(() => {
                setHeavyComponentsLoaded(true)
            }, 100)
            return () => clearTimeout(timer)
        }
    }, [loggedIn, processedInitialURL])

    return (
        <>
            {loggedIn === null ? (
                loadingStep > 0 ? (
                    <ProgressiveLoadingScreen step={loadingStep} totalSteps={5} currentMessage={loadingMessage} />
                ) : (
                    <LoadingScreen text={connectingMessage} />
                )
            ) : (
                <>
                    {/*<CookieClickerPopup />*/}
                    {loggedIn && processedInitialURL && (
                        <>
                            <GlobalModalsContainerApp />
                            <EndDayStatisticsModal />
                            <Shortcuts />
                            <InitLoadView />
                            {heavyComponentsLoaded && (
                                <>
                                    <MyDayTasksLoaders />
                                    <InFocusTaskWatcher />
                                </>
                            )}
                        </>
                    )}

                    <AppContainer ref={navigatorRef => NavigationService.setTopLevelNavigator(navigatorRef)} />
                </>
            )}
        </>
    )
}
