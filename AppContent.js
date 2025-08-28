import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'

import { LogOut } from './redux/actions'
import store from './redux/store'
import LoadingScreen from './components/LoadingScreen'
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

export default function AppContent() {
    const loggedIn = useSelector(state => state.loggedIn)
    const processedInitialURL = useSelector(state => state.processedInitialURL)

    const logoutUser = async () => {
        store.dispatch(LogOut())
        await SharedHelper.processUrlAsAnonymous()
    }

    const tryLogIn = async (firebaseUser, wait) => {
        const { registeredNewUser } = store.getState()
        const { uid: userId } = firebaseUser

        if (registeredNewUser) {
            await processNewUser(firebaseUser)
        } else {
            const user = await loadGlobalDataAndGetUser(userId)

            if (user) {
                await loadInitialDataForLoggedUser(user)
            } else if (wait > 0) {
                setTimeout(() => {
                    tryLogIn(firebaseUser, 0)
                }, wait)
            } else {
                deleteCacheAndRefresh()
            }
        }
    }

    const onInitFirabase = async firebaseUser => {
        if (firebaseUser && !firebaseUser.isAnonymous) {
            await tryLogIn(firebaseUser, 500)
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
        initIpRegistry()
        initFirebase()
        return () => {
            unwatch('userProjectWatcherUnsubKey')
        }
    }, [])

    return (
        <>
            {loggedIn === null ? (
                <LoadingScreen text="Checking sign in status" />
            ) : (
                <>
                    {/*<CookieClickerPopup />*/}
                    {loggedIn && processedInitialURL && (
                        <>
                            <GlobalModalsContainerApp />
                            <EndDayStatisticsModal />
                            <Shortcuts />
                            <InitLoadView />
                            <MyDayTasksLoaders />
                            <InFocusTaskWatcher />
                        </>
                    )}

                    <AppContainer ref={navigatorRef => NavigationService.setTopLevelNavigator(navigatorRef)} />
                </>
            )}
        </>
    )
}
