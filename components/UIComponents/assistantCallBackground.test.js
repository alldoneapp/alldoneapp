/**
 * @jest-environment jsdom
 *
 * AT-2496 — the rules that keep an assistant voice call alive while the app is
 * in the background, independent of the component that applies them.
 */
import {
    BACKGROUND_SUPPORT_BROWSER,
    BACKGROUND_SUPPORT_FOREGROUND_ONLY,
    BACKGROUND_SUPPORT_NATIVE,
    HIDDEN_DISCONNECT_GRACE_MS,
    VISIBLE_DISCONNECT_GRACE_MS,
    beginNativeCallAudioSession,
    describeBackgroundCallSupport,
    endNativeCallAudioSession,
    isDocumentHidden,
    resolveDisconnectGraceMs,
    setupMediaSession,
    shouldRecoverMicNow,
    teardownMediaSession,
} from './assistantCallBackground'

const installShell = plugin => {
    window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: plugin ? { CallAudioSession: plugin } : {},
    }
}

afterEach(() => {
    delete window.Capacitor
    jest.restoreAllMocks()
})

describe('disconnect grace', () => {
    it('is far longer while the page is hidden, and the hidden value bounds a dead call', () => {
        expect(resolveDisconnectGraceMs({ hidden: false })).toBe(VISIBLE_DISCONNECT_GRACE_MS)
        expect(resolveDisconnectGraceMs({ hidden: true })).toBe(HIDDEN_DISCONNECT_GRACE_MS)
        expect(HIDDEN_DISCONNECT_GRACE_MS).toBeGreaterThan(VISIBLE_DISCONNECT_GRACE_MS * 3)
        expect(HIDDEN_DISCONNECT_GRACE_MS).toBeLessThanOrEqual(2 * 60 * 1000)
    })

    it('reads hidden off the document', () => {
        expect(isDocumentHidden({ visibilityState: 'hidden' })).toBe(true)
        expect(isDocumentHidden({ visibilityState: 'visible' })).toBe(false)
        expect(isDocumentHidden(undefined)).toBe(false)
    })
})

describe('shouldRecoverMicNow', () => {
    it('never reopens the microphone from a hidden page', () => {
        expect(shouldRecoverMicNow({ hidden: true, track: { readyState: 'ended' } })).toBe(false)
        expect(shouldRecoverMicNow({ hidden: true, track: { readyState: 'live', muted: true } })).toBe(false)
    })

    it('recovers a visible page only for a track that ended or is muted by the OS', () => {
        expect(shouldRecoverMicNow({ hidden: false, track: { readyState: 'ended', muted: false } })).toBe(true)
        expect(shouldRecoverMicNow({ hidden: false, track: { readyState: 'live', muted: true } })).toBe(true)
        expect(shouldRecoverMicNow({ hidden: false, track: { readyState: 'live', muted: false } })).toBe(false)
        expect(shouldRecoverMicNow({ hidden: false, track: null })).toBe(false)
    })
})

describe('describeBackgroundCallSupport', () => {
    it('is native inside the iOS shell', () => {
        expect(describeBackgroundCallSupport({ capacitorIosShell: true }).level).toBe(BACKGROUND_SUPPORT_NATIVE)
    })

    it('is foreground-only in an iOS browser or home-screen PWA, including iPadOS desktop UA', () => {
        const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }
        expect(describeBackgroundCallSupport({ navigatorObject: iphone, capacitorIosShell: false }).level).toBe(
            BACKGROUND_SUPPORT_FOREGROUND_ONLY
        )
        const ipadDesktopUa = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
            platform: 'MacIntel',
            maxTouchPoints: 5,
        }
        expect(describeBackgroundCallSupport({ navigatorObject: ipadDesktopUa, capacitorIosShell: false }).level).toBe(
            BACKGROUND_SUPPORT_FOREGROUND_ONLY
        )
    })

    it('is browser-backed on Android Chrome and desktop', () => {
        const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile Safari/537.36' }
        expect(describeBackgroundCallSupport({ navigatorObject: android, capacitorIosShell: false }).level).toBe(
            BACKGROUND_SUPPORT_BROWSER
        )
        const mac = {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128',
            platform: 'MacIntel',
            maxTouchPoints: 0,
        }
        expect(describeBackgroundCallSupport({ navigatorObject: mac, capacitorIosShell: false }).level).toBe(
            BACKGROUND_SUPPORT_BROWSER
        )
    })
})

describe('native call audio session', () => {
    it('is a no-op outside the shell', async () => {
        await expect(beginNativeCallAudioSession()).resolves.toBeNull()
        await expect(endNativeCallAudioSession()).resolves.toBeUndefined()
    })

    it('returns the plugin status when the shell provides the plugin', async () => {
        const plugin = { begin: jest.fn(async () => ({ backgroundAudio: true })), end: jest.fn(async () => ({})) }
        installShell(plugin)
        await expect(beginNativeCallAudioSession()).resolves.toEqual({ backgroundAudio: true })
        await endNativeCallAudioSession()
        expect(plugin.end).toHaveBeenCalledTimes(1)
    })

    it('never rejects — a failing plugin must not stop the call from starting', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        installShell({
            begin: jest.fn(async () => {
                throw new Error('session busy')
            }),
            end: jest.fn(async () => {
                throw new Error('session busy')
            }),
        })
        await expect(beginNativeCallAudioSession()).resolves.toBeNull()
        await expect(endNativeCallAudioSession()).resolves.toBeUndefined()
    })

    it('ignores a shell that ships without the plugin (older native build)', async () => {
        installShell(null)
        await expect(beginNativeCallAudioSession()).resolves.toBeNull()
    })
})

describe('media session', () => {
    const makeMediaSession = () => ({
        metadata: null,
        playbackState: 'none',
        setActionHandler: jest.fn(),
        setMicrophoneActive: jest.fn(),
    })

    beforeEach(() => {
        global.MediaMetadata = class {
            constructor(init) {
                Object.assign(this, init)
            }
        }
    })

    afterEach(() => {
        delete global.MediaMetadata
    })

    it('registers the call as playing, marks the microphone active and routes hangup to the caller', () => {
        const mediaSession = makeMediaSession()
        const onHangup = jest.fn()
        expect(setupMediaSession({ title: 'Call with Anna', onHangup, navigatorObject: { mediaSession } })).toBe(true)

        expect(mediaSession.metadata.title).toBe('Call with Anna')
        expect(mediaSession.playbackState).toBe('playing')
        expect(mediaSession.setMicrophoneActive).toHaveBeenCalledWith(true)

        const hangup = mediaSession.setActionHandler.mock.calls.find(([action]) => action === 'hangup')[1]
        hangup()
        expect(onHangup).toHaveBeenCalledTimes(1)

        // play/pause/stop are registered (so the OS shows controls) but inert.
        const stop = mediaSession.setActionHandler.mock.calls.find(([action]) => action === 'stop')[1]
        stop()
        expect(onHangup).toHaveBeenCalledTimes(1)
    })

    it('tolerates browsers that reject the hangup action', () => {
        const mediaSession = makeMediaSession()
        mediaSession.setActionHandler.mockImplementation(action => {
            if (action === 'hangup') throw new TypeError('unsupported action')
        })
        expect(setupMediaSession({ title: 'x', navigatorObject: { mediaSession } })).toBe(true)
    })

    it('is a no-op without the API and clears everything on teardown', () => {
        expect(setupMediaSession({ title: 'x', navigatorObject: {} })).toBe(false)

        const mediaSession = makeMediaSession()
        setupMediaSession({ title: 'x', navigatorObject: { mediaSession } })
        teardownMediaSession({ navigatorObject: { mediaSession } })
        expect(mediaSession.metadata).toBeNull()
        expect(mediaSession.playbackState).toBe('none')
        expect(mediaSession.setMicrophoneActive).toHaveBeenLastCalledWith(false)
        expect(mediaSession.setActionHandler).toHaveBeenCalledWith('hangup', null)
    })
})
