/**
 * Light/dark color mode: preference handling, CSS variables and color resolution.
 */

const mockMatchMedia = dark => {
    const listeners = []
    const query = {
        matches: dark,
        addEventListener: (event, cb) => listeners.push(cb),
        removeEventListener: () => {},
    }
    window.matchMedia = jest.fn(() => query)
    return {
        setDark(next) {
            query.matches = next
            listeners.forEach(cb => cb({ matches: next }))
        },
    }
}

const load = () => {
    let mod
    jest.isolateModules(() => {
        mod = require('./colorMode')
    })
    return mod
}

describe('colorMode', () => {
    beforeEach(() => {
        window.localStorage.clear()
        document.head.innerHTML = '<meta name="theme-color" content="#FFFFFF" />'
        document.documentElement.removeAttribute('data-theme')
    })

    it('defaults to auto and follows the device', () => {
        const media = mockMatchMedia(true)
        const cm = load()
        expect(cm.getColorModePreference()).toBe('auto')
        expect(cm.getColorMode()).toBe('dark')
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
        expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(
            cm.DARK_PALETTE.AppBackground
        )

        media.setDark(false)
        expect(cm.getColorMode()).toBe('light')
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })

    it('a manual choice overrides the device and is remembered', () => {
        const media = mockMatchMedia(false)
        const cm = load()
        cm.setColorModePreference('dark')
        expect(cm.getColorMode()).toBe('dark')
        expect(window.localStorage.getItem(cm.COLOR_MODE_STORAGE_KEY)).toBe('dark')

        media.setDark(false)
        expect(cm.getColorMode()).toBe('dark')

        const reloaded = load()
        expect(reloaded.getColorModePreference()).toBe('dark')
        expect(reloaded.getColorMode()).toBe('dark')
    })

    it('ignores unknown stored values', () => {
        mockMatchMedia(false)
        window.localStorage.setItem('alldone.colorMode', 'sepia')
        const cm = load()
        expect(cm.getColorModePreference()).toBe('auto')
    })

    it('injects light and dark values for every token', () => {
        mockMatchMedia(false)
        const cm = load()
        const css = document.getElementById('alldone-color-mode').textContent
        expect(css).toContain(`--ad-Text01:${cm.LIGHT_PALETTE.Text01};`)
        expect(css).toContain(`:root[data-theme="dark"]{`)
        expect(css).toContain(`--ad-Text01:${cm.DARK_PALETTE.Text01};`)
        expect(Object.keys(cm.DARK_PALETTE).sort()).toEqual(Object.keys(cm.LIGHT_PALETTE).sort())
    })

    it('resolves tokens, alpha variants and adaptive colors to concrete values', () => {
        mockMatchMedia(false)
        const cm = load()
        expect(cm.themed.Text01).toBe('var(--ad-Text01)')
        expect(cm.resolveColor(cm.themed.Text01, 'light')).toBe('#04142F')
        expect(cm.resolveColor(cm.themed.Text01, 'dark')).toBe(cm.DARK_PALETTE.Text01)
        expect(cm.resolveColor('#123456', 'dark')).toBe('#123456')

        const alpha = cm.alphaColor(cm.themed.Text03, 0.5)
        expect(alpha).toBe('var(--ad-Text03-a500)')
        expect(cm.resolveColor(alpha, 'light')).toBe('rgba(138,148,166,0.5)')
        expect(document.getElementById('alldone-color-mode-alpha').textContent).toContain('--ad-Text03-a500')

        const adaptive = cm.adaptiveColor('#ffe6c7')
        expect(adaptive).toBe('var(--ad-hl-FFE6C7)')
        expect(cm.resolveColor(adaptive, 'light')).toBe('#FFE6C7')
        expect(cm.resolveColor(adaptive, 'dark')).toBe(cm.getHighlightDisplayColor('#FFE6C7', 'dark'))
    })

    it('shows stored highlight colors as dark tints in dark mode only', () => {
        mockMatchMedia(false)
        const cm = load()
        expect(cm.getHighlightDisplayColor('#FFE6C7', 'light')).toBe('#FFE6C7')
        expect(cm.getHighlightDisplayColor('#ffffff', 'dark')).toBe(cm.DARK_PALETTE.Surface)
        const tint = cm.getHighlightDisplayColor('#FFE6C7', 'dark')
        const [r, g, b] = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16))
        // dark, and still warm (red > blue) like the light yellow it stands for
        expect(Math.max(r, g, b)).toBeLessThan(110)
        expect(r).toBeGreaterThan(b)
        expect(cm.resolveSurfaceColor(cm.themed.Grey200, 'dark')).toBe(cm.DARK_PALETTE.Grey200)
    })

    it('hexColorToRGBa keeps working for palette tokens', () => {
        mockMatchMedia(false)
        const { hexColorToRGBa, colors } = require('../components/styles/global')
        expect(hexColorToRGBa('#FFFFFF', 0.2)).toBe('rgba(255,255,255,0.2)')
        expect(hexColorToRGBa(colors.Text03, 0.24)).toMatch(/^var\(--ad-Text03-a240\)$/)
    })
})

describe('popup surfaces', () => {
    it('stay navy in light mode and share one raised card with the Undo bar in dark mode', () => {
        const { LIGHT_PALETTE, DARK_PALETTE } = require('./colorMode')
        expect(LIGHT_PALETTE.Popup).toBe('#091540')
        expect(LIGHT_PALETTE.PopupRaised).toBe('#152560')
        expect(LIGHT_PALETTE.PopupControl).toBe('#1A3289')
        expect(DARK_PALETTE.Popup).toBe(DARK_PALETTE.SurfaceRaised)
        expect(DARK_PALETTE.Snackbar).toBe(DARK_PALETTE.Popup)
        // The input field is recessed: darker than the card it sits on.
        const lumOf = hex =>
            parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
        expect(lumOf(DARK_PALETTE.PopupField)).toBeLessThan(lumOf(DARK_PALETTE.Popup))
        expect(DARK_PALETTE.PopupFieldFill).toBe(DARK_PALETTE.PopupField)
        // Light mode keeps the navy field and its old shadow, unchanged.
        expect(LIGHT_PALETTE.PopupField).toBe('#162764')
        expect(LIGHT_PALETTE.PopupFieldFill).toBe('transparent')
        expect(LIGHT_PALETTE.PopupShadow).toBe('0px 4px 16px rgba(78,93,120,0.56)')
        expect(LIGHT_PALETTE.SnackbarShadow).toBe('0px 4px 8px rgba(0,0,0,0.20)')
        // In dark mode the shadow carries a hairline ring, so cards separate from the dark page.
        expect(DARK_PALETTE.PopupShadow).toMatch(/^0px 0px 0px 1px rgba\(255,255,255,/)
        // Rows and chips step lighter than the card, as they do on navy.
        const lum = hex => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
        expect(lum(DARK_PALETTE.PopupRaised)).toBeGreaterThan(lum(DARK_PALETTE.Popup))
        expect(lum(DARK_PALETTE.PopupControl)).toBeGreaterThan(lum(DARK_PALETTE.PopupRaised))
    })

    it('are what colors.Secondary200/300/400 point at', () => {
        const { colors } = require('../components/styles/global')
        const { themed } = require('./colorMode')
        expect(colors.Secondary400).toBe(themed.Popup)
        expect(colors.Secondary300).toBe(themed.PopupRaised)
        expect(colors.Secondary200).toBe(themed.PopupControl)
    })
})

describe('popup palette scope', () => {
    it('keeps light text tokens inside dark-mode popups, but not the popup surfaces', () => {
        jest.isolateModules(() => {
            document.getElementById('alldone-color-mode')?.remove()
            const mod = require('./colorMode')
            mod.setColorModePreference('dark')
            const css = document.getElementById('alldone-color-mode').textContent
            const scoped = css.slice(css.indexOf('.react-tiny-popover-container'))
            const body = scoped.slice(scoped.indexOf('{') + 1, scoped.indexOf('}'))
            expect(css).toContain(':root[data-theme="dark"] [data-ad-popup]')
            // Content tokens take their light values, as on the navy card in light mode.
            expect(body).toContain(`--ad-Text04:${mod.LIGHT_PALETTE.Text04};`)
            expect(body).toContain(`--ad-UtilityBlue125:${mod.LIGHT_PALETTE.UtilityBlue125};`)
            // The card, field and shadow stay on their dark values.
            expect(body).not.toContain('--ad-Popup:')
            expect(body).not.toContain('--ad-PopupField:')
            expect(body).not.toContain('--ad-PopupShadow:')
            expect(mod.isPopupScopedToken('Text01')).toBe(true)
            expect(mod.isPopupScopedToken('Popup')).toBe(false)
        })
    })
})

describe('modeColor', () => {
    it('returns one var per light/dark pair, light in light mode and popups, dark in dark mode', () => {
        const { modeColor, LIGHT_PALETTE, DARK_PALETTE } = require('./colorMode')
        const value = modeColor('#FFFFFF', 'transparent')
        expect(value).toMatch(/^var\(--ad-mc-\d+\)$/)
        expect(modeColor('#FFFFFF', 'transparent')).toBe(value)
        const name = value.slice(4, -1)
        const css = document.getElementById('alldone-color-mode-alpha').textContent
        expect(css).toContain(`:root{${name}:#FFFFFF;}`)
        expect(css).toContain(`:root[data-theme="dark"]{${name}:transparent;}`)
        expect(css).toContain(`[data-ad-popup]{${name}:#FFFFFF;}`)
        expect(LIGHT_PALETTE.AccentText).toBe('#0D55CF')
        expect(DARK_PALETTE.AccentText).not.toBe(LIGHT_PALETTE.AccentText)
    })
})

describe('structure colors on a dark surface', () => {
    it('modeColor pairs resolve to concrete values, so Animated can take them', () => {
        const { modeColor, resolveColor } = require('./colorMode')
        const value = modeColor('#ADD6FF', '#315B86')
        expect(resolveColor(value, 'light')).toBe('#ADD6FF')
        expect(resolveColor(value, 'dark')).toBe('#315B86')
    })

    it('tintForContrast mixes an accent to the same contrast whatever its hue', () => {
        const { tintForContrast, contrastRatio } = require('./colorMode')
        const card = '#232835'
        ;['#7C70FF', '#F0E219', '#FF5274', '#0AFFBE'].forEach(accent => {
            const line = tintForContrast(accent, card, 2)
            expect(contrastRatio(line, card)).toBeGreaterThanOrEqual(2)
            expect(contrastRatio(line, card)).toBeLessThan(2.1)
        })
        expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    })
})
