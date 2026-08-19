import AsyncStorage from '@react-native-async-storage/async-storage'

import store from '../redux/store'
import {
    hideConfirmPopup,
    setNewVersion,
    setShowOptionalVersionNotification,
    setShowSideBarVersionRefresher,
    setVersion,
    showConfirmPopup,
} from '../redux/actions'
import Backend from './BackendBridge'
import { selectRandomSomedayTask } from './backends/Tasks/randomSomedayTask'
import { settleWithinBudget } from './promiseBudget'

const clickObvserversCallbacks = {}

export const suscribeClickObserver = (key, callback) => {
    clickObvserversCallbacks[key] = callback
}

export const unsuscribeClickObserver = key => {
    delete clickObvserversCallbacks[key]
}

export const notifyClickObservers = evt => {
    const x = evt.nativeEvent.pageX
    const y = evt.nativeEvent.pageY
    const callbakcs = Object.values(clickObvserversCallbacks)
    for (let i = 0; i < callbakcs.length; i++) {
        callbakcs[i](x, y)
    }
}

const clickInisdeComponent = (cursorX, cursorY, componentX, componentY, componentWidth, componentHeight) => {
    return (
        cursorX < componentX + componentWidth &&
        cursorX >= componentX &&
        cursorY < componentY + componentHeight &&
        cursorY >= componentY
    )
}

export const checkIfClickInsideComponent = (cursorX, cursorY, refComp, callback, offSet = {}) => {
    if (refComp) {
        refComp.measureInWindow((componentX, componentY, componentWidth, componentHeight) => {
            const componentIsClicked = clickInisdeComponent(
                cursorX,
                cursorY,
                componentX + (offSet.componentX ? offSet.componentX : 0),
                componentY + (offSet.componentY ? offSet.componentY : 0),
                componentWidth + (offSet.componentWidth ? offSet.componentWidth : 0),
                componentHeight + (offSet.componentHeight ? offSet.componentHeight : 0)
            )

            if (!componentIsClicked) {
                callback()
            }
        })
    } else {
        callback()
    }
}

export function storeVersion() {
    Backend.getAllDoneVersion().then(version => {
        const versionNumbers = {
            major: version.major,
            minor: version.minor,
            patch: version.patch,
        }
        updateVersion(versionNumbers)
    })
}

export const LOCAL_VERSION_STORAGE_KEYS = {
    major: 'localVersionMajor',
    minor: 'localVersionMinor',
    patch: 'localVersionPatch',
}

const isUsableVersion = version => {
    if (!version) return false
    const { major, minor, patch } = version
    const parts = [major, minor, patch].map(part => parseInt(part))
    if (parts.some(part => isNaN(part))) return false
    // 0.0.0 is the redux placeholder for "not known yet", never a real release.
    return parts.some(part => part !== 0)
}

/**
 * Persists the version of the bundle the browser is about to run.
 *
 * `updateVersion` treats these three keys as "the version the last loaded
 * bundle belonged to". They are the only thing standing between a version
 * change and a forced reload, so every path that reloads on purpose has to
 * move the marker forward itself - see `deleteCacheAndRefresh`.
 */
const persistLocalVersion = async version => {
    try {
        await Promise.all([
            // AsyncStorage's native backend rejects non-string values; the web
            // backend coerces them silently. Always hand it strings.
            AsyncStorage.setItem(LOCAL_VERSION_STORAGE_KEYS.major, String(version.major)),
            AsyncStorage.setItem(LOCAL_VERSION_STORAGE_KEYS.minor, String(version.minor)),
            AsyncStorage.setItem(LOCAL_VERSION_STORAGE_KEYS.patch, String(version.patch)),
        ])
    } catch (error) {
        // Storage can be unavailable in private/restricted browser contexts.
        // A missed marker only costs the extra reload this function prevents,
        // so it must never block the refresh the user asked for.
        console.log(error)
    }
}

/**
 * Seam for the page reload. jsdom makes both `window.location` and
 * `location.reload` non-configurable, so a test cannot observe the reload
 * without one - the same reason `startDailyAppReload` takes an injected
 * `reload`. Nothing in the app should replace this.
 */
export const appReloader = {
    reload: () => window.location.reload(),
}

export const deleteCache = async () => {
    if (typeof caches !== 'undefined') {
        caches.keys().then(function (names) {
            for (let name of names) {
                // The workbox precache is the offline app shell (OFFLINE_SUPPORT_PLAN.md
                // Stage 2). Deleting it fetches nothing fresher — its entries are
                // content-hashed and revisioned, and fresh bundles only ever arrive via a
                // service worker update — but it would break offline boot until the next
                // SW install. Runtime caches are cleared as before.
                if (!name.startsWith('workbox-precache')) caches.delete(name)
            }
        })
    }

    // The reason every caller clears caches is to get onto a new release, so ask
    // the service worker to check for one right now instead of waiting for the
    // browser's own update-on-navigation cadence.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        try {
            const registration = await navigator.serviceWorker.getRegistration()
            if (registration) await registration.update()
        } catch (error) {
            // A failed update check must never block the refresh the user asked for.
        }
    }
}

const preReloadHousekeeping = async () => {
    // Try to select a random Someday task before refreshing
    const userId = store.getState().loggedUser?.uid
    if (userId) {
        try {
            await selectRandomSomedayTask(userId)
        } catch (error) {
            console.error('Error selecting random Someday task:', error)
            // Continue with refresh even if this fails
        }
    }

    await deleteCache()
}

/**
 * How long the pre-reload housekeeping may hold up the reload the user asked
 * for (AT-2367).
 *
 * Everything in front of `appReloader.reload()` is best effort, but two parts
 * of it are unbounded network work: `selectRandomSomedayTask` runs ONE
 * sequential Firestore query per project (78 of them on the dogfooding
 * account) and `deleteCache` awaits `registration.update()`, which fetches the
 * service worker script. On a slow mobile connection that is the difference
 * between a reload that starts now and one that starts half a minute from now,
 * with the "Start new day" popup sitting on screen the whole time.
 *
 * Only the version marker stays outside the budget: skipping it would make the
 * replacement page reload a second time (AT-2234), and it is a local storage
 * write.
 */
export const PRE_RELOAD_BUDGET_MS = 2000

/**
 * Clears the caches and reloads, which is what every deliberate "reload the
 * app" affordance does: the version banner, the sidebar version chip, the
 * mandatory/timeout popups, the "start a new day" modal and the error boundary.
 *
 * It also has to record the version it is reloading *into* (AT-2234). Without
 * that, a refresh triggered by a version update left the stored local version
 * on the old release, so the freshly loaded page hit the mismatch branch of
 * `updateVersion`, wrote the version and reloaded a second time - the app
 * reloaded exactly twice on every update. The version is taken from redux
 * (no network call, so an offline or degraded backend cannot delay the
 * reload); when nothing usable is known the marker is left alone and the
 * previous behaviour applies.
 */
export const deleteCacheAndRefresh = async reloadingToVersion => {
    try {
        const { alldoneNewVersion, alldoneVersion } = store.getState()

        // Most call sites are `onPress={deleteCacheAndRefresh}` and hand us a press
        // event, so the argument is validated rather than trusted. An explicit
        // version wins, then the pending release, then the running one.
        const reloadedVersion = [reloadingToVersion, alldoneNewVersion, alldoneVersion].find(isUsableVersion)
        if (reloadedVersion) await persistLocalVersion(reloadedVersion)

        await settleWithinBudget(preReloadHousekeeping(), PRE_RELOAD_BUDGET_MS)
    } catch (error) {
        // A reload the user explicitly asked for must happen no matter what.
        console.warn('Pre-reload housekeeping failed', error)
    }

    appReloader.reload()
}

const updateVersion = async serverVersion => {
    try {
        // A malformed/missing `info/version` doc must never be able to start a
        // reload: it can never match the stored marker, so it would reload on
        // every single load.
        if (!isUsableVersion(serverVersion)) {
            linkVersion(serverVersion)
            return
        }

        const localVersion = {}
        const promises = []
        promises.push(AsyncStorage.getItem(LOCAL_VERSION_STORAGE_KEYS.major))
        promises.push(AsyncStorage.getItem(LOCAL_VERSION_STORAGE_KEYS.minor))
        promises.push(AsyncStorage.getItem(LOCAL_VERSION_STORAGE_KEYS.patch))
        const [major, minor, patch] = await Promise.all(promises)
        localVersion.major = parseInt(major)
        localVersion.minor = parseInt(minor)
        localVersion.patch = parseInt(patch)
        // Compare numbers on both sides. The stored marker is always read back
        // as a string, so a server version that is stored as a string would
        // otherwise never compare equal and reload the app forever.
        if (
            localVersion.major === parseInt(serverVersion.major) &&
            localVersion.minor === parseInt(serverVersion.minor) &&
            localVersion.patch === parseInt(serverVersion.patch)
        ) {
            linkVersion(serverVersion)
        } else if (isNaN(localVersion.major) || isNaN(localVersion.minor) || isNaN(localVersion.patch)) {
            // First observed load on this browser: adopt the server version as
            // the baseline instead of reloading a perfectly current bundle.
            await persistLocalVersion(serverVersion)
            linkVersion(serverVersion)
        } else {
            // A stale bundle really is running: bust the caches and reload.
            // The marker is written for the version we are reloading into, so
            // the replacement page sees a match and stays put.
            await deleteCacheAndRefresh(serverVersion)
        }
    } catch (error) {
        console.log(error)
        linkVersion(serverVersion)
    }
}

const linkVersion = version => {
    store.dispatch(setVersion(version))
    Backend.watchAllDoneVersion(selectVersionNotification)
}

const selectVersionNotification = newVersion => {
    const currentVersion = store.getState().alldoneVersion
    if (newVersion && (currentVersion.major !== newVersion.major || currentVersion.minor !== newVersion.minor)) {
        if (newVersion.isMandatory) {
            distpachVersionNotificationData(false, false, newVersion, true)
        } else {
            distpachVersionNotificationData(true, true, newVersion, false)
        }
    }
}

const distpachVersionNotificationData = (
    showSideBarVersionRefresher,
    showOptionalVersionNotification,
    newVersion,
    showModal
) => {
    store.dispatch([
        setShowSideBarVersionRefresher(showSideBarVersionRefresher),
        setShowOptionalVersionNotification(showOptionalVersionNotification),
        setNewVersion(newVersion),
        showModal
            ? showConfirmPopup({ trigger: 'CONFIRM POPUP MANDATORY NOTIFICATION', object: {} })
            : hideConfirmPopup(),
    ])
}
