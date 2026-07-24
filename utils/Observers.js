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

export const deleteCache = async () => {
    // const registrations = await navigator.serviceWorker.getRegistration()
    // if (registrations) {
    //     if (Array.isArray(registrations)) {
    //         for (let registration of registrations) {
    //             registration.unregister()
    //         }
    //     } else {
    //         registrations.unregister()
    //     }
    // }

    if (caches) {
        caches.keys().then(function (names) {
            for (let name of names) caches.delete(name)
        })
    }
}

export const deleteCacheAndRefresh = async () => {
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
    window.location.reload()
}

const updateVersion = async serverVersion => {
    try {
        const localVersion = {}
        const promises = []
        promises.push(AsyncStorage.getItem('localVersionMajor'))
        promises.push(AsyncStorage.getItem('localVersionMinor'))
        promises.push(AsyncStorage.getItem('localVersionPatch'))
        const [major, minor, patch] = await Promise.all(promises)
        localVersion.major = parseInt(major)
        localVersion.minor = parseInt(minor)
        localVersion.patch = parseInt(patch)
        if (
            localVersion.major === serverVersion.major &&
            localVersion.minor === serverVersion.minor &&
            localVersion.patch === serverVersion.patch
        ) {
            linkVersion(serverVersion)
        } else if (isNaN(localVersion.major) || isNaN(localVersion.minor) || isNaN(localVersion.patch)) {
            AsyncStorage.setItem('localVersionMajor', serverVersion.major)
            AsyncStorage.setItem('localVersionMinor', serverVersion.minor)
            AsyncStorage.setItem('localVersionPatch', serverVersion.patch)
            linkVersion(serverVersion)
        } else {
            AsyncStorage.setItem('localVersionMajor', serverVersion.major).then(() => {
                AsyncStorage.setItem('localVersionMinor', serverVersion.minor).then(() => {
                    AsyncStorage.setItem('localVersionPatch', serverVersion.patch).then(async () => {
                        await deleteCacheAndRefresh()
                    })
                })
            })
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
