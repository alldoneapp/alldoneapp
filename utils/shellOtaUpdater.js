import { isCapacitorShell } from './CapacitorShell'

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

// Where the manifest lives. HOSTING_URL is env-injected per environment, but ONLY
// into the BEGIN-ENVS block of utils/backends/firestore.js — that block, and two
// like it, are the whole of what ci/replace-envs.sh (and the equivalent sed in
// .gitlab-ci.yml) rewrites. A second `import { HOSTING_URL } from
// 'react-native-dotenv'` in this file is not covered by that pass, so it survives
// into the bundle as an unresolved dotenv import and fails the production build
// outright: `"HOSTING_URL" is not defined in .env` (there is no .env in the web
// build images — react-native-dotenv only ever resolves what the sed left behind).
// Read it through the accessor firestore.js already exports instead.
//
// Required lazily, and inside the check rather than at module scope, for the
// reason in the header: this module's EVALUATION races appReadyTimeout, and a
// static import would put the whole Firestore client in front of notifyAppReady().
const resolveHostingUrl = () => {
    try {
        // eslint-disable-next-line global-require
        return require('./backends/firestore').getHostingUrl() || ''
    } catch (error) {
        return ''
    }
}

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

    const hostingUrl = resolveHostingUrl()
    if (!hostingUrl) {
        // Nothing to compare against: a relative fetch from inside the shell
        // resolves against capacitor://localhost, not the deployment.
        console.log('[shellOta] not updating: no hosting url')
        return
    }

    try {
        // Own identity is served from the RUNNING bundle (relative fetch), the
        // manifest from the live hosting for this environment.
        const currentInfo = await readJson('./ota-version.json')
        const latestInfo = await readJson(`${hostingUrl}/ota/latest.json`)
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
            url: `${hostingUrl}${latestInfo.url}`,
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

// Returns the "check now" callback for the resume signal, or a no-op outside the
// shell. It deliberately does NOT register a visibilitychange listener of its own:
// utils/appResume.js is the single owner of "the app just came back" (PT-4660),
// and re-deriving that here would be wrong in exactly the case this feature exists
// for — an iOS home-screen/shell app announces its return with `pageshow` (a
// bfcache restore), which a bare visibilitychange listener never observes.
// AppNavigator hands this to installAppResumeListener as `onResume`.
export const installShellOtaUpdater = () => {
    const updater = getUpdaterPlugin()
    if (!updater) return () => {}

    updater.notifyAppReady().catch(() => {})

    checkAndApply(updater)
    return () => checkAndApply(updater)
}
