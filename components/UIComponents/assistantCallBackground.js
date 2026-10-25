/**
 * Everything that keeps an assistant voice call alive while the app is NOT in
 * the foreground, in one place — so the four platforms the call ships on can
 * be reasoned about together (AT-2496).
 *
 * The call itself is a browser WebRTC peer connection straight to OpenAI (see
 * AssistantVoiceCallButton). Nothing here changes how the audio flows; it
 * decides how the component reacts when the page is hidden, and it talks to
 * the native shell where one exists. What "background" means per platform:
 *
 *   Web / desktop PWA   The tab keeps running. Chromium exempts tabs with a live
 *                       WebRTC connection from intensive timer throttling, so the
 *                       health poll keeps working at ≥1Hz and the mic keeps flowing.
 *   Android (TWA)       Chrome itself owns the microphone and shows its own
 *                       "microphone in use" notification; the tab stays alive
 *                       while it captures. Our MediaSession registration is what
 *                       gives that notification a title and a hang-up action.
 *   iOS Capacitor shell WebKit routes the web view's audio session into the
 *                       host app (RemoteAudioSession), so the app's `audio`
 *                       UIBackgroundMode (ios-app Info.plist) is what lets the
 *                       capture survive the home button / lock screen. The
 *                       CallAudioSession plugin configures the session for a
 *                       voice chat before capture starts and releases it after.
 *   iOS Safari / PWA    No lever at all: WebKit mutes the capture track while the
 *                       page is hidden and unmutes it on return. The best we can
 *                       do is NOT tear the call down in the meantime and NOT try
 *                       to reopen the mic while hidden (getUserMedia is refused
 *                       from a hidden page), then let the track unmute itself.
 *
 * Two rules fall out of that last line and they hold on every platform:
 *   1. A hidden page never opens the microphone. Recovery is deferred until the
 *      page is visible again, and even then it waits RETURN_MIC_SETTLE_MS for
 *      the OS to hand the original track back before replacing it.
 *   2. A 'disconnected' peer connection is given a much longer grace while the
 *      page is hidden. ICE routinely reports 'disconnected' the moment a tab
 *      backgrounds and recovers seconds later; hanging up on it is the bug.
 *      When the page returns the grace collapses back to the visible value, so
 *      a call that really died in the background ends within seconds of return
 *      rather than a minute later.
 */

import { getNativeCallAudioSessionPlugin, isCapacitorIosShell } from '../../utils/CapacitorShell'

/** Grace before a 'disconnected' peer connection is treated as terminal, page visible. */
export const VISIBLE_DISCONNECT_GRACE_MS = 8000

/** Same grace while the page is hidden — long enough for a lock-screen wobble, short enough to not bill a dead call. */
export const HIDDEN_DISCONNECT_GRACE_MS = 60000

/**
 * After the page becomes visible again, how long to wait for the OS to unmute
 * the original mic track before we replace it with a fresh getUserMedia.
 * WebKit unmutes within a few hundred ms of return; replacing the track during
 * that window would drop the first words spoken after coming back.
 */
export const RETURN_MIC_SETTLE_MS = 1500

export const BACKGROUND_SUPPORT_NATIVE = 'native'
export const BACKGROUND_SUPPORT_BROWSER = 'browser'
export const BACKGROUND_SUPPORT_FOREGROUND_ONLY = 'foreground_only'

export function resolveDisconnectGraceMs({ hidden }) {
    return hidden ? HIDDEN_DISCONNECT_GRACE_MS : VISIBLE_DISCONNECT_GRACE_MS
}

export function isDocumentHidden(documentObject = typeof document === 'undefined' ? undefined : document) {
    return !!documentObject && documentObject.visibilityState === 'hidden'
}

/**
 * Whether a track that looks unhealthy should be replaced right now. Never
 * while the page is hidden (rule 1 above); when visible, only when the track
 * has actually ended or is muted by the OS.
 */
export function shouldRecoverMicNow({ hidden, track }) {
    if (hidden || !track) return false
    return track.readyState === 'ended' || track.muted === true
}

function isAppleMobileBrowser(navigatorObject) {
    const ua = (navigatorObject && navigatorObject.userAgent) || ''
    const platform = (navigatorObject && navigatorObject.platform) || ''
    const maxTouchPoints = (navigatorObject && navigatorObject.maxTouchPoints) || 0
    if (/iPhone|iPad|iPod/i.test(ua)) return true
    // iPadOS reports a desktop Safari UA; the touch-point count is the tell.
    return platform === 'MacIntel' && maxTouchPoints > 1
}

/**
 * How well the current environment can carry a call in the background. Used
 * to decide whether to tell the user to keep the app open — the honest answer
 * on an iOS browser or home-screen PWA, where nothing on the web side can keep
 * the microphone alive once the page is hidden.
 */
export function describeBackgroundCallSupport({
    navigatorObject = typeof navigator === 'undefined' ? undefined : navigator,
    capacitorIosShell = isCapacitorIosShell(),
} = {}) {
    if (capacitorIosShell) {
        return { level: BACKGROUND_SUPPORT_NATIVE, reason: 'ios_shell_background_audio' }
    }
    if (isAppleMobileBrowser(navigatorObject)) {
        return { level: BACKGROUND_SUPPORT_FOREGROUND_ONLY, reason: 'ios_browser_mutes_hidden_capture' }
    }
    return { level: BACKGROUND_SUPPORT_BROWSER, reason: 'browser_keeps_capturing_tab_alive' }
}

// ---------------------------------------------------------------------------
// Native shell audio session (iOS Capacitor). No-ops outside the shell.
// ---------------------------------------------------------------------------

/**
 * Configure the host app's audio session for a voice chat BEFORE the web view
 * opens the microphone. Resolves with the plugin's status (`backgroundAudio`
 * says whether the build carries the `audio` UIBackgroundMode) or null when
 * there is no shell / no plugin / the call failed — never rejects, the call
 * must start either way.
 */
export async function beginNativeCallAudioSession() {
    const plugin = getNativeCallAudioSessionPlugin()
    if (!plugin || typeof plugin.begin !== 'function') return null
    try {
        const status = await plugin.begin()
        return status || {}
    } catch (error) {
        console.warn('[VoiceCall] Native audio session could not be configured:', error?.message || error)
        return null
    }
}

export async function endNativeCallAudioSession() {
    const plugin = getNativeCallAudioSessionPlugin()
    if (!plugin || typeof plugin.end !== 'function') return
    try {
        await plugin.end()
    } catch (error) {
        console.warn('[VoiceCall] Native audio session could not be released:', error?.message || error)
    }
}

// ---------------------------------------------------------------------------
// Media Session — registers the call as the active media session. On Android
// this is what Chrome's ongoing-call notification is built from (title + a
// hang-up button); on desktop it exposes the call to hardware media keys. The
// `hangup` action is the only one that does anything: it ends the call from
// the notification / lock screen without bringing the app forward.
// ---------------------------------------------------------------------------
export function setupMediaSession({ title, onHangup, navigatorObject = navigator } = {}) {
    try {
        const mediaSession = navigatorObject && navigatorObject.mediaSession
        if (!mediaSession) return false
        if (typeof MediaMetadata === 'function') {
            mediaSession.metadata = new MediaMetadata({ title: title || 'Voice call', artist: 'Alldone', album: '' })
        }
        mediaSession.playbackState = 'playing'
        // Chrome only surfaces a media notification for a session that handles
        // actions; play/pause/stop are deliberately inert — pausing a call is
        // not a thing, and 'stop' from a headset button must not hang up.
        const inert = ['play', 'pause', 'stop']
        inert.forEach(action => {
            try {
                mediaSession.setActionHandler(action, () => {})
            } catch (_) {
                /* action not supported here */
            }
        })
        try {
            mediaSession.setActionHandler('hangup', () => {
                if (typeof onHangup === 'function') onHangup()
            })
        } catch (_) {
            /* 'hangup' is Chromium-only */
        }
        try {
            if (typeof mediaSession.setMicrophoneActive === 'function') mediaSession.setMicrophoneActive(true)
        } catch (_) {
            /* optional */
        }
        return true
    } catch (_) {
        return false
    }
}

export function teardownMediaSession({ navigatorObject = navigator } = {}) {
    try {
        const mediaSession = navigatorObject && navigatorObject.mediaSession
        if (!mediaSession) return
        try {
            if (typeof mediaSession.setMicrophoneActive === 'function') mediaSession.setMicrophoneActive(false)
        } catch (_) {
            /* optional */
        }
        ;['play', 'pause', 'stop', 'hangup'].forEach(action => {
            try {
                mediaSession.setActionHandler(action, null)
            } catch (_) {
                /* ignore */
            }
        })
        mediaSession.metadata = null
        mediaSession.playbackState = 'none'
    } catch (_) {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// Silent audio keepalive — a near-silent oscillator keeps an AudioContext
// running so the browser counts the tab as actively playing audio (the remote
// party is silent between turns, and a tab that is neither capturing nor
// playing is the one the OS suspends first).
// ---------------------------------------------------------------------------
export function createSilentAudioKeepalive(windowObject = typeof window === 'undefined' ? undefined : window) {
    try {
        const Ctor = windowObject && (windowObject.AudioContext || windowObject.webkitAudioContext)
        if (!Ctor) return null
        const audioContext = new Ctor()
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        gainNode.gain.value = 0.001
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        oscillator.start()
        return { audioContext, oscillator, gainNode }
    } catch (_) {
        return null
    }
}

export function destroySilentAudioKeepalive(keepalive) {
    if (!keepalive) return
    try {
        keepalive.oscillator.stop()
    } catch (_) {
        /* ignore */
    }
    try {
        keepalive.audioContext.close()
    } catch (_) {
        /* ignore */
    }
}
