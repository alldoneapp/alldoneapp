import { isCapacitorShell } from './CapacitorShell'
import { HOSTING_URL } from 'react-native-dotenv'

// Self-hosted over-the-air updates for the iOS Capacitor shell.
//
// Every web deploy publishes itself as /ota/latest.json + an immutable
// /ota/bundle-<sha>.zip on the SAME hosting the web app ships from (see
// ci/buildOtaBundle.js; the /ota/** CORS header in firebase.json is what lets
// a capacitor:// origin read the manifest). The shell checks that manifest on
// boot and whenever it returns to the foreground, downloads a differing
// version through @capgo/capacitor-updater, and applies it — so an installed
// iOS app tracks web deploys without an App Store release.
//
// Update policy: only bundles whose ota-version.json carries channel 'ci' ever
// self-update, and only TO a latest.json also carrying channel 'ci'. A locally
// built dev shell is 'local' and stays put — otherwise it would replace itself
// with the deployed web the moment it launches.
//
// Rollback guard: the plugin reverts (and deletes) a new bundle unless the
// boot calls notifyAppReady() within appReadyTimeout (60s in
// capacitor.config.json). That call happens at MODULE EVALUATION below, not
// component mount — the timeout races the entire app bootstrap, and a slow
// first paint losing that race puts the shell into an endless
// download-revert-redownload loop (observed live before this fix).

const CHECK_THROTTLE_MS = 5 * 60 * 1000

export const OTA_DECISION = {
    APPLY: 'apply',
    UP_TO_DATE: 'up_to_date',
    LOCAL_BUILD: 'local_build',
    BAD_MANIFEST: 'bad_manifest',
}

// Pure: decide what to do given the running bundle's identity and the fetched
// manifest. Exported for tests.
export const resolveOtaDecision = (currentInfo, latestInfo) => {
    if (!currentInfo || currentInfo.channel !== 'ci') return OTA_DECISION.LOCAL_BUILD
    if (
        !latestInfo ||
        latestInfo.channel !== 'ci' ||
        typeof latestInfo.version !== 'string' ||
        !latestInfo.version ||
        typeof latestInfo.url !== 'string' ||
        !latestInfo.url.startsWith('/ota/')
    ) {
        return OTA_DECISION.BAD_MANIFEST
    }
    if (latestInfo.version === currentInfo.version) return OTA_DECISION.UP_TO_DATE
    return OTA_DECISION.APPLY
}

const getUpdaterPlugin = () => {
    if (!isCapacitorShell()) return null
    const plugins = window.Capacitor.Plugins
    return (plugins && plugins.CapacitorUpdater) || null
}

// Confirm the boot as healthy as early as possible (see header comment). The
// call is idempotent; installShellOtaUpdater repeats it for safety.
try {
    const earlyUpdater = getUpdaterPlugin()
    if (earlyUpdater) earlyUpdater.notifyAppReady().catch(() => {})
} catch (error) {
    // Never let the guard break bundle evaluation.
}

let lastCheckAt = 0
let applying = false

const readJson = async url => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
}

const checkAndApply = async updater => {
    if (applying) return
    const now = Date.now()
    if (now - lastCheckAt < CHECK_THROTTLE_MS) return
    lastCheckAt = now

    try {
        // Own identity is served from the RUNNING bundle (relative fetch), the
        // manifest from the live hosting for this environment.
        const currentInfo = await readJson('./ota-version.json')
        const latestInfo = await readJson(`${HOSTING_URL}/ota/latest.json`)
        const decision = resolveOtaDecision(currentInfo, latestInfo)
        if (decision !== OTA_DECISION.APPLY) {
            if (decision !== OTA_DECISION.UP_TO_DATE) {
                console.log(`[shellOta] not updating: ${decision}`)
            }
            return
        }

        applying = true
        console.log(`[shellOta] downloading web bundle ${latestInfo.version.slice(0, 12)}`)
        const bundle = await updater.download({
            url: `${HOSTING_URL}${latestInfo.url}`,
            version: latestInfo.version,
        })
        console.log('[shellOta] applying update (webview will reload)')
        // set() reloads the webview into the new bundle; if that boot never
        // reaches notifyAppReady, the plugin restores the previous bundle.
        await updater.set(bundle)
    } catch (error) {
        console.error('[shellOta] update check failed:', error)
        applying = false
    }
}

export const installShellOtaUpdater = () => {
    const updater = getUpdaterPlugin()
    if (!updater) return

    updater.notifyAppReady().catch(() => {})

    checkAndApply(updater)
    const onVisible = () => {
        if (document.visibilityState === 'visible') checkAndApply(updater)
    }
    document.addEventListener('visibilitychange', onVisible)
}
