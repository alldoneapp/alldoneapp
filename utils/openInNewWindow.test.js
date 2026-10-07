/**
 * AT-2345 — "Open view in new window" must reach a real browser tab from an installed PWA.
 *
 * The regression these tests pin is invisible in an ordinary browser: `window.open(location,
 * '_blank')` is correct there and only misbehaves inside an installed app window, where the
 * in-scope target keeps the navigation in the app. So every case below is really a statement
 * about WHICH url the button opens for a given display mode.
 */
import {
    BROWSER_TAB_REDIRECT_FUNCTION,
    buildBrowserBounceUrl,
    isInstalledAppWindow,
    isIosHomeScreenApp,
    openViewInNewWindow,
    shouldRouteThroughBrowserBounce,
} from './openInNewWindow'

jest.mock('./BackendBridge', () => ({
    __esModule: true,
    default: {
        getFirebaseProjectId: () => 'alldonealeph',
        getFunctionsRegion: () => 'europe-west1',
    },
}))

const NOTE_URL = 'https://my.alldone.app/projects/-M6X9vdIokG7HAammHGg/notes/-P-Fxx/editor'
const BOUNCE_ORIGIN = 'https://europe-west1-alldonealeph.cloudfunctions.net'

let openSpy

const setDisplayMode = mode => {
    // jsdom has no matchMedia. Model the real contract: exactly one display-mode matches.
    window.matchMedia = jest.fn(query => ({ matches: query === `(display-mode: ${mode})`, media: query }))
}

// jsdom's window.location is non-configurable, so tests pass the destination explicitly and
// one dedicated case covers the "no argument ⇒ current location" default.
const CURRENT_HREF = window.location.href

beforeEach(() => {
    openSpy = jest.fn(() => ({ focus: () => {} }))
    window.open = openSpy
    setDisplayMode('browser')
    delete window.navigator.standalone
})

describe('display-mode detection', () => {
    test('an ordinary browser tab is not an installed app window', () => {
        expect(isInstalledAppWindow()).toBe(false)
        expect(shouldRouteThroughBrowserBounce()).toBe(false)
    })

    test.each(['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'])(
        'display-mode %s counts as an installed app window',
        mode => {
            setDisplayMode(mode)
            expect(isInstalledAppWindow()).toBe(true)
            expect(shouldRouteThroughBrowserBounce()).toBe(true)
        }
    )

    test('an iOS home-screen app is standalone but must NOT be bounced', () => {
        setDisplayMode('standalone')
        window.navigator.standalone = true

        expect(isIosHomeScreenApp()).toBe(true)
        expect(isInstalledAppWindow()).toBe(true)
        // There `_blank` already hands the url to the browser; a bounce would only add a hop.
        expect(shouldRouteThroughBrowserBounce()).toBe(false)
    })

    test('a browser without matchMedia degrades to "not installed"', () => {
        delete window.matchMedia
        expect(isInstalledAppWindow()).toBe(false)
    })

    test('a throwing matchMedia degrades to "not installed" instead of breaking the click', () => {
        window.matchMedia = () => {
            throw new Error('nope')
        }
        expect(isInstalledAppWindow()).toBe(false)
    })
})

describe('bounce url', () => {
    test('targets the Cloud Functions origin, which is outside the manifest scope', () => {
        const bounce = buildBrowserBounceUrl(NOTE_URL)

        expect(bounce).toBe(`${BOUNCE_ORIGIN}/${BROWSER_TAB_REDIRECT_FUNCTION}?u=${encodeURIComponent(NOTE_URL)}`)
        // The whole point: a different origin from the app's hosting domain.
        expect(new URL(bounce).origin).not.toBe(new URL(NOTE_URL).origin)
    })

    test('percent-encodes the destination so its query and hash survive the hop', () => {
        const withQuery = `${NOTE_URL}?tab=editor&x=a b#frag`
        const bounce = buildBrowserBounceUrl(withQuery)

        expect(new URL(bounce).searchParams.get('u')).toBe(withQuery)
    })

    test('returns null for an empty target rather than a bounce to nowhere', () => {
        expect(buildBrowserBounceUrl('')).toBeNull()
        expect(buildBrowserBounceUrl(undefined)).toBeNull()
    })
})

describe('openViewInNewWindow', () => {
    test('browser tab: opens the destination directly, exactly as before', () => {
        openViewInNewWindow(NOTE_URL)

        expect(openSpy).toHaveBeenCalledTimes(1)
        expect(openSpy).toHaveBeenCalledWith(NOTE_URL, '_blank')
    })

    test('with no argument it opens the current location', () => {
        openViewInNewWindow()

        expect(openSpy).toHaveBeenCalledWith(CURRENT_HREF, '_blank')
    })

    test('installed desktop PWA: opens the out-of-scope bounce instead of the in-scope url', () => {
        setDisplayMode('standalone')

        openViewInNewWindow(NOTE_URL)

        expect(openSpy).toHaveBeenCalledTimes(1)
        const [url, target] = openSpy.mock.calls[0]
        expect(url).toBe(`${BOUNCE_ORIGIN}/${BROWSER_TAB_REDIRECT_FUNCTION}?u=${encodeURIComponent(NOTE_URL)}`)
        expect(target).toBe('_blank')
    })

    test('installed desktop PWA: the current location is bounced when no argument is given', () => {
        setDisplayMode('standalone')

        openViewInNewWindow()

        expect(new URL(openSpy.mock.calls[0][0]).searchParams.get('u')).toBe(CURRENT_HREF)
    })

    test('iOS home-screen app: keeps the direct call (no redirector dependency on mobile)', () => {
        setDisplayMode('standalone')
        window.navigator.standalone = true

        openViewInNewWindow(NOTE_URL)

        expect(openSpy).toHaveBeenCalledWith(NOTE_URL, '_blank')
    })

    test('a blocked bounce popup falls back to the direct call, never to a no-op', () => {
        setDisplayMode('standalone')
        openSpy.mockReturnValueOnce(null)

        openViewInNewWindow(NOTE_URL)

        expect(openSpy).toHaveBeenCalledTimes(2)
        expect(openSpy.mock.calls[1]).toEqual([NOTE_URL, '_blank'])
    })

    test('an unresolvable project id falls back to the direct call', () => {
        setDisplayMode('standalone')
        const Backend = require('./BackendBridge').default
        const spy = jest.spyOn(Backend, 'getFirebaseProjectId').mockReturnValue(undefined)

        openViewInNewWindow(NOTE_URL)

        expect(openSpy).toHaveBeenCalledTimes(1)
        expect(openSpy).toHaveBeenCalledWith(NOTE_URL, '_blank')
        spy.mockRestore()
    })

    test('returns whatever window.open returned, preserving the old call signature', () => {
        const handle = { focus: () => {} }
        openSpy.mockReturnValue(handle)

        expect(openViewInNewWindow(NOTE_URL)).toBe(handle)
    })
})
