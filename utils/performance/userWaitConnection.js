import { startConnectionLatencySample } from '../connectionHealth'

let finishAppBootWait = null

/**
 * Start the user-visible boot wait as early as App.js itself is evaluated.
 *
 * Firestore snapshot timers are intentionally tied to the individual watcher
 * that owns them. That makes them accurate operation measurements, but it also
 * means a watcher created late in boot cannot enforce a five-second promise
 * from the user's point of view. This named sample spans the whole signed-in
 * app boot and is finished by AppContent after the first ready paint.
 */
export const startAppBootConnectionWait = () => {
    if (finishAppBootWait) return
    finishAppBootWait = startConnectionLatencySample('app_boot')
}

export const finishAppBootConnectionWait = () => {
    if (!finishAppBootWait) return
    const finish = finishAppBootWait
    finishAppBootWait = null
    finish()
}

export const __resetUserWaitConnectionForTests = () => {
    finishAppBootConnectionWait()
}
