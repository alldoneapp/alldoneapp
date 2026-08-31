import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import {
    LogOut,
    setInitialUrl,
    setPendingWebShareTarget,
    setResolvingSharedResource,
    storeLoggedUser,
} from './redux/actions'
import store from './redux/store'
import LoadingScreen from './components/LoadingScreen'
import ProgressiveLoadingScreen from './components/ProgressiveLoadingScreen'
import Backend from './utils/BackendBridge'
import NavigationService from './utils/NavigationService'
import GlobalModalsContainerApp from './components/UIComponents/GlobalModalsContainerApp'
import { deleteCacheAndRefresh } from './utils/Observers'
import SharedHelper from './utils/SharedHelper'
import { withSheetHistoryLayers } from './utils/sheetHistoryLayers'
import { isBrowserOffline } from './utils/connectionState'
import { scheduleNotesOfflinePrefetch } from './utils/NotesOfflinePrefetch'
import { scheduleNotesOfflineCatchUp } from './utils/NotesOfflineCatchUp'
import {
    endNamedPerformanceTrace,
    markNamedPerformanceTrace,
    schedulePerformanceAfterPaint,
} from './utils/performance/performanceLogger'
import { finishAppBootConnectionWait } from './utils/performance/userWaitConnection'
import { syncServerClock } from './utils/serverClock'
import { initIpRegistry } from './utils/Geolocation/GeolocationHelper'
import InitLoadView from './components/InitLoadView/InitLoadView'
import InFocusTaskWatcher from './components/InitLoadView/InFocusTaskWatcher'
import { processNewUser } from './utils/InitialLoad/newUserHelper'
import { loadGlobalDataAndGetUserResult, loadInitialDataForLoggedUser } from './utils/InitialLoad/loggedUserHelper'
import { LOGIN_FAILURE_ACTIONS, describeLoginError, resolveLoginFailureAction } from './utils/Auth/authErrorHelper'
import { AppContainer } from './AppNavigator'
import URLTrigger from './URLSystem/URLTrigger'
import { unwatch } from './utils/backends/firestore'
import Shortcuts from './components/UIComponents/ShortcutCheatSheet/Shortcuts'
import EndDayStatisticsModal from './components/UIComponents/FloatModals/EndDayStatisticsModal'
import MyDayTasksLoaders from './components/MyDayView/MyDayLoaders/MyDayTasksLoaders'
import { getConnectingMessage } from './utils/FunnyLoadingMessages'
import AnalyticsConsentManager from './components/Analytics/AnalyticsConsentManager'
import UndoActionBar from './components/Undo/UndoActionBar'
import { cleanWebShareTargetParamsFromCurrentUrl, loadPendingWebShareTarget } from './utils/webShareTarget'
import { ensureIosShareExtensionCredential } from './utils/iosShareExtensionCredential'
import { runBootIntegrityCheck } from './utils/InitialLoad/bootIntegrityHealer'
import useDeferredStartupWork, { useInitialTaskDataPublished } from './hooks/useDeferredStartupWork'
import { warmTypesenseSearchCredentials } from './utils/typesenseSearch'

// A failing initial data load is retried a few times before the user is told about it - and the
// session is kept in every case (see handleLoginFailure).
const MAX_LOGIN_ATTEMPTS = 3
const LOGIN_RETRY_DELAY_MS = 3000

// Capture this synchronously, before the login screen or URL router can replace
// the incoming share-target URL. The payload itself is consumed only after the
// All Projects add-task popup has opened.
const pendingWebShareTargetAtBoot = loadPendingWebShareTarget()

const getCurrentUrl = () => `${window.location.pathname}${window.location.search}`

// A public page (currently the /meet/<slug> booking page) belongs to nobody: it needs no account,
// no Firebase session and no app data, and an unregistered visitor must land on it directly. The
// route is therefore resolved during the FIRST render, before anything is committed - not from an
// effect. Mounting the login screen even for one frame is not harmless: its own effects rewrite the
// address bar to /login (losing the booking link on a refresh) and start an anonymous sign-in.
const resolvePublicPageUrl = () => {
    const url = getCurrentUrl()
    if (!SharedHelper.matchesPublicPageUrl(url)) return null
    // Only NavigationService's route store is touched here (no redux dispatch during render):
    // AppContainer reads it when it is constructed, i.e. right after this render returns.
    URLTrigger.directProcessUrl(NavigationService, url)
    return url
}

export default function AppContent() {
    const loggedIn = useSelector(state => state.loggedIn)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    // NOTE: the dismissible-touch DOM capture listener that master's incident
    // fix installed here lives in AppNavigator's AppContainer on this branch —
    // one listener only, or every press dismisses twice.
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const navigationRoute = useSelector(state => state.route)
    const loadingStep = useSelector(state => state.loadingStep)
    const loadingMessage = useSelector(state => state.loadingMessage)
    const [heavyComponentsLoaded, setHeavyComponentsLoaded] = useState(false)
    const [publicPageUrl] = useState(resolvePublicPageUrl)
    const [connectingMessage] = useState(() => getConnectingMessage())
    const initialTaskDataPublished = useInitialTaskDataPublished()
    const deferredStartupWorkReady = useDeferredStartupWork({ enabled: loggedIn && processedInitialURL })
    // onAuthStateChanged can fire again while an initial load (incl. its retries) is still
    // running. Two concurrent loads race on the same watchers and redux state, so the second one
    // for the same user is ignored.
    const loginInProgressUid = useRef(null)

    const logoutUser = async () => {
        const currentUrl = getCurrentUrl()

        // Public page: on boot it is already on screen (resolvePublicPageUrl routed it during the
        // first render). Keep it there - no login UI, and no anonymous sign-in either, since
        // nothing on the page reads Firestore. This reads the CURRENT url rather than the one
        // captured at boot, so signing out somewhere else in the app still ends on the login
        // screen. Access control for every other route is untouched.
        if (SharedHelper.matchesPublicPageUrl(currentUrl)) {
            store.dispatch(LogOut())
            URLTrigger.directProcessUrl(NavigationService, currentUrl)
            return
        }

        // Anonymous visitor opening a shared resource detail link (chat, note, task, …): resolve it
        // and forward straight to the view in the boot path, WITHOUT ever mounting the login screen.
        // We capture the URL and flag the resolution up-front so the login route renders a neutral
        // loading screen (see LoginScreen.js) — the login UI never shows and /login is never pushed
        // into the address bar (the resource URL stays put the whole time).
        if (SharedHelper.matchesSharedResourceUrl(currentUrl)) {
            // The anonymous sign-in performed during resolution re-fires this auth callback; ignore
            // that re-entry so we don't resolve (and reload project data) twice.
            if (store.getState().resolvingSharedResource) return
            store.dispatch([LogOut(), setInitialUrl(currentUrl), setResolvingSharedResource(true)])
            try {
                await SharedHelper.processUrlAsAnonymous()
            } catch (error) {
                // On failure, fall back to the normal login UI rather than a stuck loading screen.
                store.dispatch(setResolvingSharedResource(false))
                throw error
            }
            return
        }

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

            // Provisioning is multi-stage. If the authoritative user/project batch succeeded and
            // a supplementary step failed afterwards, continue with that valid account instead of
            // offering to delete its Auth identity and leaving orphaned Firestore data behind.
            const recovered = await loadGlobalDataAndGetUserResult(userId)
            if (recovered.user) {
                await loadInitialDataForLoggedUser(recovered.user)
                console.warn('Signup completed with a supplementary provisioning error; using the recovered account.')
                return true
            }

            // Keep the Auth identity. A missing document can be retried safely on the next login;
            // deleting Auth here is destructive and made partial signup failures unrecoverable.
            const recoveryError = new Error(
                `Account setup for ${email || userId} did not complete. The authentication was preserved; ` +
                    'please retry the login.'
            )
            recoveryError.cause = error
            throw recoveryError
        }
    }

    const signOut = async () => {
        try {
            await new Promise(resolve => Backend.logout(resolve))
        } catch (e) {
            console.error('Logout failed:', e)
        }
    }

    /**
     * A failure while loading the initial data must NOT end a valid session. Only an explicitly
     * invalid/revoked authentication signs the user out; everything else is retried and, if it
     * keeps failing, reported while the user stays signed in.
     */
    const handleLoginFailure = async (firebaseUser, error, attempt) => {
        const details = describeLoginError(error)
        console.error('Error during login:', error, { attempt, ...details })

        if (resolveLoginFailureAction(error) === LOGIN_FAILURE_ACTIONS.SIGN_OUT) {
            console.warn(`Authentication is no longer valid (${details.code}) - signing out`)
            alert(
                `Your session is no longer valid: ${details.message}\n\n` +
                    'You will be logged out. Please sign in again.'
            )
            await signOut()
            return
        }

        if (attempt < MAX_LOGIN_ATTEMPTS - 1) {
            const delay = LOGIN_RETRY_DELAY_MS * (attempt + 1)
            console.warn(
                `Initial data load failed (${details.code || details.name}) - keeping the session and retrying in ` +
                    `${delay}ms (attempt ${attempt + 2}/${MAX_LOGIN_ATTEMPTS})`
            )
            await new Promise(resolve => setTimeout(resolve, delay))
            await tryLogIn(firebaseUser, 0, attempt + 1)
            return
        }

        console.error('Initial data could not be loaded after several attempts. The user stays signed in.', details)

        // Offline, the reload dialog is a dead end (reloading cannot make data
        // appear); retry the whole initial load automatically when connectivity
        // returns instead (OFFLINE_SUPPORT_PLAN.md Stage 5).
        if (isBrowserOffline()) {
            console.warn('Browser is offline - the initial load will retry when connectivity returns')
            const retryWhenBackOnline = () => {
                window.removeEventListener('online', retryWhenBackOnline)
                tryLogIn(firebaseUser, 0, 0)
            }
            window.addEventListener('online', retryWhenBackOnline)
            return
        }

        const shouldReload = confirm(
            `The app could not finish loading your data: ${details.message}\n\n` +
                'You are still signed in.\n\n' +
                '• Click OK to reload the app\n' +
                '• Click Cancel to stay on this screen'
        )
        if (shouldReload) window.location.reload()
    }

    const tryLogIn = async (firebaseUser, wait, attempt = 0) => {
        const { registeredNewUser } = store.getState()
        const { uid: userId } = firebaseUser

        if (registeredNewUser) {
            await processNewUser(firebaseUser)
        } else {
            try {
                const { user, missing, error, deferredUserResult } = await loadGlobalDataAndGetUserResult(userId)

                if (user) {
                    markNamedPerformanceTrace('app_boot', 'user_loaded', {
                        project_count: Array.isArray(user.projectIds) ? user.projectIds.length : 0,
                        from_cache: !!deferredUserResult,
                    })
                    await loadInitialDataForLoggedUser(user)
                    markNamedPerformanceTrace('app_boot', 'initial_data_loaded', {
                        project_count: Array.isArray(user.projectIds) ? user.projectIds.length : 0,
                    })
                    // Warm the offline note-content cache once the session is idle
                    // (OFFLINE_SUPPORT_PLAN.md notes follow-ups); also re-runs on
                    // reconnect. Fire-and-forget by design.
                    scheduleNotesOfflinePrefetch()
                    // The mirror image of the prefetch: push note content that was
                    // edited offline and never reached Firebase Storage, which has
                    // no offline write queue of its own (AT-2340). Also re-runs on
                    // reconnect. Fire-and-forget by design.
                    scheduleNotesOfflineCatchUp()
                    // Measure the server-clock offset once the session is up, so
                    // the first note save already has it. Fire-and-forget: every
                    // caller falls back to the client clock (AT-2340).
                    syncServerClock().catch(() => {})

                    if (deferredUserResult) {
                        deferredUserResult
                            .then(async freshResult => {
                                // A sign-out or account switch supersedes this boot's refresh.
                                const currentState = store.getState()
                                if (currentState.loggedUser?.uid !== userId) return

                                if (freshResult.user) {
                                    store.dispatch(storeLoggedUser({ ...currentState.loggedUser, ...freshResult.user }))
                                    await runBootIntegrityCheck({ trigger: 'cached_user_refresh' })
                                } else if (freshResult.missing) {
                                    // Preserve the old authoritative-missing behavior. The cache
                                    // accelerates rendering; it never masks a deleted user doc.
                                    await handleMissingUserDocument(firebaseUser)
                                } else if (freshResult.error) {
                                    console.warn(
                                        'Current user data could not be refreshed after cached startup.',
                                        freshResult.error
                                    )
                                }
                            })
                            .catch(refreshError =>
                                console.warn('Current user background refresh failed:', refreshError)
                            )
                    }
                } else if (error) {
                    // The read failed (offline, transient permission error). This is NOT a missing
                    // account, so never run the account-recovery/delete path for it.
                    throw error
                } else if (wait > 0) {
                    setTimeout(() => {
                        tryLogIn(firebaseUser, 0, attempt)
                    }, wait)
                } else if (missing) {
                    // User document really doesn't exist in Firestore - try to recover
                    await handleMissingUserDocument(firebaseUser)
                } else {
                    throw new Error('User data could not be loaded')
                }
            } catch (error) {
                await handleLoginFailure(firebaseUser, error, attempt)
            }
        }
    }

    const onInitFirabase = async firebaseUser => {
        markNamedPerformanceTrace('app_boot', 'auth_resolved', {
            outcome: firebaseUser && !firebaseUser.isAnonymous ? 'signed_in' : 'signed_out',
        })
        if (firebaseUser && !firebaseUser.isAnonymous) {
            if (loginInProgressUid.current === firebaseUser.uid) {
                console.log('Login already in progress for this user, ignoring the repeated auth event')
                return
            }
            loginInProgressUid.current = firebaseUser.uid
            try {
                await tryLogIn(firebaseUser, 0)
            } finally {
                loginInProgressUid.current = null
            }
        } else {
            loginInProgressUid.current = null
            finishAppBootConnectionWait()
            await logoutUser()
        }
    }

    const initFirebase = async () => {
        Backend.initFirebase(async firebaseUser => {
            await onInitFirabase(firebaseUser)
            // Sheets get the back button first (Phase 5): while a bottom
            // sheet is open a pop closes it instead of navigating.
            window.onpopstate = withSheetHistoryLayers(SharedHelper.onHistoryPop)
        })
    }

    useEffect(() => {
        if (publicPageUrl) {
            finishAppBootConnectionWait()
            store.dispatch(setInitialUrl(publicPageUrl))
        }
    }, [publicPageUrl])

    useEffect(() => {
        if (pendingWebShareTargetAtBoot) {
            store.dispatch(setPendingWebShareTarget(pendingWebShareTargetAtBoot))
        }
        cleanWebShareTargetParamsFromCurrentUrl()
    }, [])

    useEffect(() => {
        if (!loggedIn || !loggedUserId) return
        ensureIosShareExtensionCredential(loggedUserId).catch(error =>
            console.warn('Could not prepare the iOS share extension', error)
        )
    }, [loggedIn, loggedUserId])

    useEffect(() => {
        initFirebase()
        // Initialize IP registry in background after Firebase auth
        setTimeout(() => {
            initIpRegistry()
        }, 100)
        return () => {
            finishAppBootConnectionWait()
            unwatch('userProjectWatcherUnsubKey')
        }
    }, [])

    // Once the anonymous visitor has been forwarded off the login screen (to the resource view or
    // the private-resource page), clear the resolving flag so the login UI can render normally if
    // they ever return to it.
    useEffect(() => {
        if (navigationRoute && navigationRoute !== 'LoginScreen' && store.getState().resolvingSharedResource) {
            store.dispatch(setResolvingSharedResource(false))
        }
    }, [navigationRoute])

    // My Day mirrors start several task listeners per active project. Keep them
    // out of the first task board's network window and release them when the
    // first task stream publishes (or the bounded non-task-route fallback).
    useEffect(() => {
        if (loggedIn && processedInitialURL && deferredStartupWorkReady) {
            // Delay mounting heavy components by 100ms to allow UI to render first
            const timer = setTimeout(() => {
                setHeavyComponentsLoaded(true)
            }, 100)
            return () => clearTimeout(timer)
        }
        setHeavyComponentsLoaded(false)
    }, [deferredStartupWorkReady, loggedIn, processedInitialURL])

    // The first Typesense search otherwise has to wait for a cold callable request that creates a
    // short-lived, user-scoped key. Start that handshake after foreground task data has settled;
    // the Search modal repeats this best-effort warm-up and both paths share one in-flight request.
    useEffect(() => {
        if (!loggedIn || !processedInitialURL || !deferredStartupWorkReady) return
        warmTypesenseSearchCredentials()
    }, [deferredStartupWorkReady, loggedIn, processedInitialURL])

    useEffect(() => {
        if (!loggedIn || !processedInitialURL) return undefined
        return schedulePerformanceAfterPaint(() => {
            markNamedPerformanceTrace('app_boot', 'app_shell_ready', {
                project_count: Array.isArray(store.getState().loggedUser?.projectIds)
                    ? store.getState().loggedUser.projectIds.length
                    : 0,
            })
            finishAppBootConnectionWait()
        })
    }, [loggedIn, processedInitialURL])

    useEffect(() => {
        if (!loggedIn || !processedInitialURL || !deferredStartupWorkReady) return undefined
        return schedulePerformanceAfterPaint(() => {
            endNamedPerformanceTrace('app_boot', 'task_data_ready', {
                outcome: 'success',
                source: initialTaskDataPublished ? 'task_stream' : 'fallback',
                project_count: Array.isArray(store.getState().loggedUser?.projectIds)
                    ? store.getState().loggedUser.projectIds.length
                    : 0,
            })
        })
    }, [deferredStartupWorkReady, initialTaskDataPublished, loggedIn, processedInitialURL])

    return (
        <>
            <AnalyticsConsentManager />
            {loggedIn === null && !publicPageUrl ? (
                loadingStep > 0 ? (
                    <ProgressiveLoadingScreen step={loadingStep} totalSteps={5} currentMessage={loadingMessage} />
                ) : (
                    <LoadingScreen text={connectingMessage} />
                )
            ) : (
                <>
                    {loggedIn && processedInitialURL && (
                        <>
                            <GlobalModalsContainerApp />
                            <UndoActionBar />
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
