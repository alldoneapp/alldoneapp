/**
 * The one owner of "the app just came back" (PT-4660).
 *
 * A browser announces a resume several ways and reliably fires more than one of
 * them for the same event: `visibilitychange` (tab shown), Page Lifecycle
 * `resume` (a frozen Android page thawed), `pageshow` (a bfcache restore — the
 * usual one for an iOS home-screen PWA), and `focus` (window refocused). Nothing
 * in the app treated them as one thing, so every
 * consumer that wanted to react to a resume either picked one signal and missed
 * another lifecycle path, or listened broadly and ran several times.
 *
 * This module coalesces them into ONE `resume` callback carrying the duration the
 * app was away, and grades the reaction by that duration — because the reaction
 * is what costs. Tabbing away for ten seconds must cost nothing at all; coming
 * back to a laptop that slept overnight should re-check everything.
 *
 *   < RESUME_IGNORE_MS      nothing. No network, no UI movement, no listener work.
 *   >= RESUME_PROBE_MS      probe the connection (utils/connectionHealth.js)
 *   >= RESUME_INTEGRITY_MS  additionally re-run the boot integrity check
 *   >= RESUME_SW_UPDATE_MS  additionally ask the service worker to check for a new build
 *
 * Deliberately NOT handled here: the local-day rollover. `utils/DailyAppReload.js`
 * already listens to these same three events and performs a full reload when the
 * calendar day changed while the app was away — duplicating that decision here
 * would race it and could reload a page that is already reloading.
 *
 * Adding another input signal is one line in SIGNALS — which is the point. The
 * iOS Capacitor shell suspends its WKWebView and exposes a native
 * `App.appStateChange` hook that is more reliable than `visibilitychange`; when
 * App Store delivery lands, it plugs in there and everything downstream is unchanged.
 */

/** Below this a resume is a no-op. Tabbing in and out of the app must stay free. */
export const RESUME_IGNORE_MS = 30 * 1000

/** At or above this, actively verify the server is reachable. */
export const RESUME_PROBE_MS = 30 * 1000

/** At or above this, also re-check that the initial load did not leave data behind. */
export const RESUME_INTEGRITY_MS = 5 * 60 * 1000

/** At or above this, also ask the service worker whether a newer build exists. */
export const RESUME_SW_UPDATE_MS = 60 * 60 * 1000

/**
 * Two signals for the same resume land microseconds apart, but a bfcache restore
 * can emit `pageshow` then `focus` a few hundred ms later. One second swallows
 * the pair without swallowing two genuine resumes.
 */
export const RESUME_COALESCE_MS = 1000

const SIGNALS = [
    // Only visibilitychange means "the app just went away". Chrome may emit
    // focus/pageshow/resume while the document still reports hidden; treating
    // any of those as another hide would overwrite the real background start
    // time and make the later visible event look like a sub-second no-op.
    { target: 'document', type: 'visibilitychange', recordsHiddenAt: true },
    // Chrome freezes background pages on Android and reports the thaw through
    // the Page Lifecycle API before (or without, when it stays hidden) the
    // ordinary return signals.
    { target: 'document', type: 'resume', recordsHiddenAt: false },
    { target: 'window', type: 'pageshow' },
    { target: 'window', type: 'focus' },
]

const requestServiceWorkerUpdate = navigatorObject => {
    if (!navigatorObject || !navigatorObject.serviceWorker) return
    try {
        const result = navigatorObject.serviceWorker.getRegistration()
        if (!result || typeof result.then !== 'function') return
        result
            .then(registration => {
                if (registration && typeof registration.update === 'function') registration.update()
            })
            .catch(() => {})
    } catch (error) {
        // Service workers are unavailable in private modes and non-secure contexts.
    }
}

const runBootIntegrityCheckSafely = () => {
    try {
        // Lazily required: this module is installed from AppNavigator, and a static
        // import would pull the Firestore client and the redux store into every
        // test that touches a resume.
        // eslint-disable-next-line global-require
        const { runBootIntegrityCheck } = require('./InitialLoad/bootIntegrityHealer')
        runBootIntegrityCheck({ trigger: 'app_resume' }).catch(error =>
            console.warn('[AppResume] Integrity check failed:', error)
        )
    } catch (error) {
        console.warn('[AppResume] Integrity check unavailable:', error)
    }
}

const evaluateConnectionSafely = hiddenMs => {
    try {
        // eslint-disable-next-line global-require
        const { handleAppResume } = require('./connectionHealth')
        handleAppResume({ hiddenMs, probeAfterMs: RESUME_PROBE_MS }).catch(() => {})
    } catch (error) {
        console.warn('[AppResume] Connection probe unavailable:', error)
    }
}

/**
 * @param onResume optional extra observer, invoked with `{ hiddenMs }` after the
 *        built-in reactions are dispatched. Used by tests and by any future
 *        consumer that needs the coalesced signal without re-deriving it.
 */
export const installAppResumeListener = ({
    windowObject = typeof window === 'undefined' ? undefined : window,
    documentObject = typeof document === 'undefined' ? undefined : document,
    navigatorObject = typeof navigator === 'undefined' ? undefined : navigator,
    now = () => Date.now(),
    coalesceMs = RESUME_COALESCE_MS,
    ignoreMs = RESUME_IGNORE_MS,
    integrityMs = RESUME_INTEGRITY_MS,
    serviceWorkerUpdateMs = RESUME_SW_UPDATE_MS,
    onResume,
    evaluateConnection = evaluateConnectionSafely,
    runIntegrityCheck = runBootIntegrityCheckSafely,
    updateServiceWorker = requestServiceWorkerUpdate,
} = {}) => {
    if (!windowObject || !windowObject.addEventListener || !documentObject) return () => {}

    let lastActiveAt = now()
    let lastResumeAt = 0

    const isHidden = () => documentObject.visibilityState === 'hidden'

    const handleResume = () => {
        const at = now()
        // Same resume, reported twice by two different APIs.
        if (at - lastResumeAt < coalesceMs) return
        lastResumeAt = at

        const hiddenMs = at - lastActiveAt
        lastActiveAt = at

        if (hiddenMs < ignoreMs) return

        evaluateConnection(hiddenMs)
        if (hiddenMs >= integrityMs) runIntegrityCheck()
        if (hiddenMs >= serviceWorkerUpdateMs) updateServiceWorker(navigatorObject)
        if (typeof onResume === 'function') onResume({ hiddenMs })
    }

    const handleSignal = recordsHiddenAt => () => {
        if (isHidden()) {
            // A return-ish signal can arrive before visibilityState flips to
            // visible. Ignore it without erasing how long the app was away; the
            // ensuing visibilitychange will perform the resume with the real age.
            if (recordsHiddenAt) lastActiveAt = now()
            return
        }
        handleResume()
    }

    const listeners = SIGNALS.map(({ target, type, recordsHiddenAt = false }) => {
        const node = target === 'document' ? documentObject : windowObject
        const listener = handleSignal(recordsHiddenAt)
        node.addEventListener(type, listener)
        return () => node.removeEventListener(type, listener)
    })

    return () => listeners.forEach(remove => remove())
}
