/**
 * @jest-environment jsdom
 *
 * AT-2954: which address the "open in new tab" button may open, and how it opens it.
 */
const mockOpenViewInNewWindow = jest.fn()
jest.mock('../../../../utils/openInNewWindow', () => ({
    openViewInNewWindow: (...args) => mockOpenViewInNewWindow(...args),
}))

const { resolveReportedLocation, openEmbeddedAppInNewTab } = require('./embeddedAppLocation')

const START = 'https://alldone.team/connor-consultant/story-builder'

describe('resolveReportedLocation', () => {
    it('accepts a page on the frame’s own origin, query and hash included', () => {
        expect(resolveReportedLocation('https://alldone.team/connor-consultant/story-builder/s1?step=2#x', START)).toBe(
            'https://alldone.team/connor-consultant/story-builder/s1?step=2#x'
        )
    })

    it.each([
        ['another origin', 'https://evil.example/phish'],
        ['a subdomain', 'https://evil.alldone.team/x'],
        ['plain http on an https app', 'http://alldone.team/x'],
        ['a javascript: url', 'javascript:alert(1)'],
        ['a relative path', '/connor-consultant'],
        ['garbage', 'not a url'],
        ['a non-string', { href: START }],
        ['an empty string', ''],
        ['an oversized url', `${START}?q=${'a'.repeat(5000)}`],
    ])('refuses %s', (_, reported) => {
        expect(resolveReportedLocation(reported, START)).toBeNull()
    })

    it('refuses everything when the start url itself is unusable', () => {
        expect(resolveReportedLocation(START, 'not a url')).toBeNull()
    })
})

describe('openEmbeddedAppInNewTab', () => {
    let open

    beforeEach(() => {
        open = jest.spyOn(window, 'open')
        mockOpenViewInNewWindow.mockReset()
    })

    afterEach(() => open.mockRestore())

    it('opens a third-party app directly in a new tab and cuts the opener', () => {
        const tab = { opener: window }
        open.mockReturnValue(tab)

        expect(openEmbeddedAppInNewTab(START)).toBe(true)
        expect(open).toHaveBeenCalledWith(START, '_blank')
        expect(tab.opener).toBeNull()
        expect(mockOpenViewInNewWindow).not.toHaveBeenCalled()
    })

    it('reports a blocked pop-up', () => {
        open.mockReturnValue(null)
        expect(openEmbeddedAppInNewTab(START)).toBe(false)
    })

    it('still reports success when the opener cannot be cut any more', () => {
        const tab = {}
        Object.defineProperty(tab, 'opener', {
            set() {
                throw new Error('SecurityError')
            },
        })
        open.mockReturnValue(tab)
        expect(openEmbeddedAppInNewTab(START)).toBe(true)
    })

    it('routes an app on Alldone’s own origin through the installed-app escape (AT-2345)', () => {
        const own = `${window.location.origin}/projects/tasks/open`
        mockOpenViewInNewWindow.mockReturnValueOnce({}).mockReturnValueOnce(null)

        expect(openEmbeddedAppInNewTab(own)).toBe(true)
        expect(mockOpenViewInNewWindow).toHaveBeenCalledWith(own)
        expect(open).not.toHaveBeenCalled()
        expect(openEmbeddedAppInNewTab(own)).toBe(false)
    })

    it('does nothing without a url', () => {
        expect(openEmbeddedAppInNewTab('')).toBe(false)
        expect(open).not.toHaveBeenCalled()
    })
})
