/**
 * Light / dark color mode for the whole app.
 *
 * How it works: every color that has to change between light and dark mode is a CSS custom
 * property (`var(--ad-Text01)`). react-native-web passes `var(...)` colors straight through to
 * the DOM, so a StyleSheet created once at module load still flips live when the
 * `data-theme` attribute on <html> changes — no reload, no re-render needed.
 *
 * The user preference is `auto` (follow the device: browser, iOS app (WKWebView) and Android
 * app (TWA) all report it through `prefers-color-scheme`), `light` or `dark`. It is kept in
 * localStorage (read again by the inline boot script in web-bundler/index.html so the first
 * paint already has the right background) and in `users/{uid}.colorMode` so it follows the
 * user to other devices.
 *
 * Rules:
 * - Only use tokens for colors that are rendered, never for values that are stored (task
 *   highlight colors, project colors and Themes/Colors.js stay plain hex).
 * - Code that needs a real color value (Animated color interpolation, canvas, three.js,
 *   chart libraries) must call `resolveColor(value)` and re-render through `useColorMode()`.
 * - Alpha variants of a token go through `alphaColor(token, alpha)` (or hexColorToRGBa,
 *   which delegates here), never through string concatenation.
 */
import { useSyncExternalStore } from 'react'

export const COLOR_MODE_AUTO = 'auto'
export const COLOR_MODE_LIGHT = 'light'
export const COLOR_MODE_DARK = 'dark'
export const COLOR_MODE_PREFERENCES = [COLOR_MODE_AUTO, COLOR_MODE_LIGHT, COLOR_MODE_DARK]

export const COLOR_MODE_STORAGE_KEY = 'alldone.colorMode'
const VAR_PREFIX = '--ad-'
const STYLE_ELEMENT_ID = 'alldone-color-mode'
const ALPHA_STYLE_ELEMENT_ID = 'alldone-color-mode-alpha'

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined'

// ---------------------------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------------------------

const DARK_SURFACE = '#151A23'

const parseHex = hex => {
    let h = String(hex).replace('#', '')
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const toHex = rgb =>
    '#' +
    rgb
        .map(v =>
            Math.max(0, Math.min(255, Math.round(v)))
                .toString(16)
                .padStart(2, '0')
        )
        .join('')
        .toUpperCase()

/** Mix `color` over `base` with the given weight of `color` (0..1). */
export const mixHex = (color, base, weight) => {
    const a = parseHex(color)
    const b = parseHex(base)
    return toHex(a.map((v, i) => v * weight + b[i] * (1 - weight)))
}

const relativeLuminance = hex => {
    const [r, g, b] = parseHex(hex).map(v => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio (1..21) between two hex colors. */
export const contrastRatio = (a, b) => {
    const la = relativeLuminance(a)
    const lb = relativeLuminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * `accent` mixed into the dark `background` just far enough to reach `contrast` against it.
 * Use it for lines and fills that carry structure on a dark surface: a fixed mixing weight makes
 * a yellow accent glare while a violet one stays invisible, a fixed contrast reads the same for
 * every hue. The accent must be lighter than the background; if it cannot reach the contrast it
 * is returned as it is.
 */
export const tintForContrast = (accent, background, contrast) => {
    let low = 0
    let high = 1
    for (let i = 0; i < 12; i++) {
        const weight = (low + high) / 2
        if (contrastRatio(mixHex(accent, background, weight), background) < contrast) low = weight
        else high = weight
    }
    return mixHex(accent, background, high)
}

// Tinted backgrounds (the *100 … *150 steps) are light pastels in light mode. In dark mode
// they become the accent mixed into the dark surface, so a "light green" chip stays a green
// chip without glaring.
const TINT_STEPS = { 100: 0.14, 112: 0.2, 125: 0.28, 150: 0.5 }
const TINT_FAMILIES = {
    UtilityBlue: { accent: '#3D9BFF', light: { 100: '#EBF5FF', 112: '#D6EBFF', 125: '#C7E3FF', 150: '#A3D1FF' } },
    UtilityGreen: { accent: '#09C485', light: { 100: '#EAFFF8', 112: '#C7F5E5', 125: '#ADF0D9', 150: '#7BEAC5' } },
    UtilityYellow: { accent: '#F59A1F', light: { 100: '#FFF6EB', 112: '#FFEDD6', 125: '#FFE6C7', 150: '#FFCE8F' } },
    UtilityRed: { accent: '#F03A3A', light: { 100: '#FFEBEB', 112: '#FFD6D6', 125: '#FFC7C7', 150: '#FFA3A3' } },
    UtilityOrange: { accent: '#FF7043', light: { 100: '#FFE8E0', 112: '#FFE0D6', 125: '#FFD4C7', 150: '#FFB59E' } },
    UtilityViolet: { accent: '#9A63FF', light: { 100: '#ECE0FF', 112: '#E5D6FF', 125: '#DBC7FF', 150: '#A16BFF' } },
    UtilityLime: { accent: '#B5C200', light: { 100: '#F0F3CE', 112: '#EAF0AF', 125: '#E0EA80', 150: '#CCDA49' } },
    UtilityDarkBlue: { accent: '#4D85FF', light: { 100: '#F0F4FF', 112: '#E6EEFF', 125: '#D6E3FF', 150: '#B8CFFF' } },
}

const LIGHT_BASE = {
    // Surfaces
    Surface: '#FFFFFF',
    SurfaceRaised: '#FFFFFF',
    AppBackground: '#FFFFFF',
    GraySidebar: '#F5F5F5',
    WhiteGray: '#E3E5EA',
    Grey100: '#FAFBFB',
    Grey200: '#F1F3F4',
    Grey300: '#E7ECEF',
    Grey350: '#D6DDE1',
    Grey400: '#C6CDD2',
    // components/styles/global.js historically defines Grey500 as a light background
    Grey500Bg: '#F7F7F7',
    Gray500: '#718592',
    // Text
    Text01: '#04142F',
    Text02: '#4E5D78',
    Text03: '#8A94A6',
    Text04: '#B7BDC8',
    // Secondary buttons
    SecondaryButton: '#EAF0F5',
    SecondaryButton_Pressed: '#E3EBF2',
    SecondaryButton_Focus: '#F1F5F8',
    SecondaryButton_Default_Occlusion: '#D3DAE2',
    // Selected row in the light sidebar
    SidebarSelected: '#D6EBFF',
    // Generic overlay used behind modals
    Backdrop: 'rgba(4, 20, 47, 0.24)',
    Shadow: 'rgba(4, 20, 47, 0.24)',
    // Floating notification bars (the Undo bar) carry white text. Navy on the light page; in
    // dark mode the same raised card as popups, never the near-white of Text01.
    Snackbar: 'rgba(4, 20, 47, 0.8)',
    SnackbarShadow: '0px 4px 8px rgba(0,0,0,0.20)',
    // Blue text on a blue tint (milestone date chips). Primary300 is too dark on the dark tint.
    AccentText: '#0D55CF',
    // Popups (FloatModals, sheets, the add-task card) and the Undo bar: navy on the light page.
    // In dark mode one raised neutral card with a hairline ring, a recessed input field and grey
    // controls, so the only blue left is the focus and the primary action.
    Popup: '#091540',
    PopupRaised: '#152560',
    PopupControl: '#1A3289',
    // The edit-form field inside a popup (input + its button bar).
    PopupField: '#162764',
    PopupFieldFill: 'transparent',
    PopupFieldBorder: '#162764',
    PopupShadow: '0px 4px 16px rgba(78,93,120,0.56)',
}

const DARK_BASE = {
    Surface: DARK_SURFACE,
    SurfaceRaised: '#1C2230',
    AppBackground: '#10141B',
    GraySidebar: '#10141B',
    WhiteGray: '#2B3342',
    Grey100: '#1A202B',
    Grey200: '#202734',
    Grey300: '#283041',
    Grey350: '#2F384A',
    Grey400: '#3A4557',
    Grey500Bg: '#1D2430',
    Gray500: '#8C9AA8',
    Text01: '#E6EAF1',
    Text02: '#AEB8CA',
    Text03: '#8692A7',
    Text04: '#5B6679',
    SecondaryButton: '#232C3B',
    SecondaryButton_Pressed: '#29334A',
    SecondaryButton_Focus: '#1F2735',
    SecondaryButton_Default_Occlusion: '#313B4E',
    SidebarSelected: '#1B3555',
    Backdrop: 'rgba(0, 0, 0, 0.55)',
    Shadow: 'rgba(0, 0, 0, 0.6)',
    Snackbar: '#1C2230',
    SnackbarShadow: '0px 0px 0px 1px rgba(255,255,255,0.08), 0px 8px 24px rgba(0,0,0,0.55)',
    AccentText: '#6EA8FF',
    Popup: '#1C2230',
    PopupRaised: '#252C3A',
    PopupControl: '#2C3546',
    PopupField: '#141923',
    PopupFieldFill: '#141923',
    PopupFieldBorder: 'rgba(255, 255, 255, 0.10)',
    PopupShadow: '0px 0px 0px 1px rgba(255,255,255,0.08), 0px 12px 32px rgba(0,0,0,0.55)',
}

const buildPalettes = () => {
    const light = { ...LIGHT_BASE }
    const dark = { ...DARK_BASE }
    Object.entries(TINT_FAMILIES).forEach(([family, { accent, light: lightSteps }]) => {
        Object.entries(lightSteps).forEach(([step, lightHex]) => {
            light[`${family}${step}`] = lightHex
            dark[`${family}${step}`] = mixHex(accent, DARK_SURFACE, TINT_STEPS[step])
        })
    })
    return { light, dark }
}

export const PALETTES = buildPalettes()
export const LIGHT_PALETTE = PALETTES.light
export const DARK_PALETTE = PALETTES.dark

/** `var(--ad-Name)` for a palette token. */
export const tokenVar = name => `var(${VAR_PREFIX}${name})`

/** Object of `var(...)` strings, one per palette token: `themed.Text01`, `themed.Surface`, … */
export const themed = Object.keys(LIGHT_PALETTE).reduce((acc, key) => {
    acc[key] = tokenVar(key)
    return acc
}, {})

const TOKEN_VAR_RE = /^var\(--ad-([A-Za-z0-9_]+)\)$/

// ---------------------------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------------------------

const paletteToCss = palette =>
    Object.entries(palette)
        .map(([key, value]) => `${VAR_PREFIX}${key}:${value};`)
        .join('')

// Popups were designed as dark cards on a light page: their content uses the light palette's
// light text and tint tokens (`Text04`, `Grey400`, `UtilityBlue125`) on a navy card. In dark mode
// only the card itself changes, so inside a popup every token keeps its light value except the
// popup's own surfaces. Without this scope those tokens flip to their dark values and the text in
// popups turns dark on a dark card.
export const POPUP_SCOPE_ATTRIBUTE = 'data-ad-popup'
export const POPUP_SCOPE_SELECTOR = `.react-tiny-popover-container,[${POPUP_SCOPE_ATTRIBUTE}]`
const POPUP_OWN_TOKENS = new Set([
    'Popup',
    'PopupRaised',
    'PopupControl',
    'PopupField',
    'PopupFieldFill',
    'PopupFieldBorder',
    'PopupShadow',
    'Snackbar',
    'SnackbarShadow',
    'Backdrop',
    'Shadow',
])
export const isPopupScopedToken = name => !POPUP_OWN_TOKENS.has(name)

const darkPopupScope = selectorBody =>
    POPUP_SCOPE_SELECTOR.split(',')
        .map(selector => `:root[data-theme="dark"] ${selector}`)
        .join(',') + `{${selectorBody}}`

const injectPaletteCss = () => {
    if (!hasDom || document.getElementById(STYLE_ELEMENT_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ELEMENT_ID
    const popupScoped = Object.fromEntries(Object.entries(LIGHT_PALETTE).filter(([key]) => isPopupScopedToken(key)))
    style.textContent =
        `:root{${paletteToCss(LIGHT_PALETTE)}}` +
        `:root[data-theme="dark"]{${paletteToCss(DARK_PALETTE)}color-scheme:dark;}` +
        `:root[data-theme="light"]{color-scheme:light;}` +
        darkPopupScope(paletteToCss(popupScoped))
    document.head.appendChild(style)
}

// Alpha variants are created on demand: each one becomes its own custom property with a light
// and a dark value, so `alphaColor(themed.Text03, 0.5)` still flips live.
const registeredAlphaVars = new Set()

const appendDynamicVar = (varName, lightValue, darkValue, { popupKeepsLight = true } = {}) => {
    if (!hasDom) return
    let style = document.getElementById(ALPHA_STYLE_ELEMENT_ID)
    if (!style) {
        style = document.createElement('style')
        style.id = ALPHA_STYLE_ELEMENT_ID
        document.head.appendChild(style)
    }
    style.appendChild(
        document.createTextNode(
            `:root{${varName}:${lightValue};}:root[data-theme="dark"]{${varName}:${darkValue};}` +
                (popupKeepsLight ? darkPopupScope(`${varName}:${lightValue};`) : '')
        )
    )
}

const hexToRgba = (hex, alpha) => {
    const [r, g, b] = parseHex(hex)
    return `rgba(${r},${g},${b},${alpha})`
}

const withAlpha = (value, alpha) => {
    if (typeof value !== 'string') return value
    if (value.startsWith('#')) return hexToRgba(value, alpha)
    const m = value.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
        const [r, g, b] = m[1].split(',').map(s => s.trim())
        return `rgba(${r},${g},${b},${alpha})`
    }
    return value
}

/**
 * Color with alpha. Works with hex values and with palette tokens (`themed.X` / `colors.X`).
 */
export const alphaColor = (color, alpha) => {
    const match = typeof color === 'string' ? color.match(TOKEN_VAR_RE) : null
    if (!match) return withAlpha(color, alpha)
    const name = match[1]
    const alphaKey = String(Math.round(alpha * 1000))
    const varName = `${VAR_PREFIX}${name}-a${alphaKey}`
    if (!registeredAlphaVars.has(varName)) {
        registeredAlphaVars.add(varName)
        appendDynamicVar(varName, withAlpha(LIGHT_PALETTE[name], alpha), withAlpha(DARK_PALETTE[name], alpha), {
            popupKeepsLight: isPopupScopedToken(name),
        })
    }
    return `var(${varName})`
}

// ---------------------------------------------------------------------------------------------
// Mode state
// ---------------------------------------------------------------------------------------------

const normalizePreference = pref => (COLOR_MODE_PREFERENCES.includes(pref) ? pref : COLOR_MODE_AUTO)

const readStoredPreference = () => {
    try {
        return normalizePreference(hasDom ? window.localStorage.getItem(COLOR_MODE_STORAGE_KEY) : null)
    } catch (e) {
        return COLOR_MODE_AUTO
    }
}

const darkQuery = hasDom && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export const getSystemColorMode = () => (darkQuery && darkQuery.matches ? COLOR_MODE_DARK : COLOR_MODE_LIGHT)

export const resolveColorModePreference = pref => {
    const p = normalizePreference(pref)
    return p === COLOR_MODE_AUTO ? getSystemColorMode() : p
}

let preference = readStoredPreference()
let mode = resolveColorModePreference(preference)
const listeners = new Set()
let snapshot = { preference, mode }

const updateThemeColorMeta = () => {
    if (!hasDom) return
    const content = mode === COLOR_MODE_DARK ? DARK_PALETTE.AppBackground : LIGHT_PALETTE.AppBackground
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', content))
}

const applyMode = () => {
    if (hasDom) {
        const root = document.documentElement
        // color-scheme comes from the injected CSS per data-theme; no inline style on <html>
        // (other code saves and restores its style attribute exactly).
        root.setAttribute('data-theme', mode)
        updateThemeColorMeta()
    }
    snapshot = { preference, mode }
    listeners.forEach(listener => listener())
}

const recompute = () => {
    const next = resolveColorModePreference(preference)
    if (next !== mode || snapshot.preference !== preference) {
        mode = next
        applyMode()
    }
}

export const getColorMode = () => mode
export const getColorModePreference = () => preference
export const isDarkMode = () => mode === COLOR_MODE_DARK

/** Set the user's preference (`auto` | `light` | `dark`) on this device. */
export const setColorModePreference = pref => {
    const next = normalizePreference(pref)
    try {
        if (hasDom) window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next)
    } catch (e) {}
    if (next === preference) return
    preference = next
    recompute()
}

export const subscribeColorMode = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const getSnapshot = () => snapshot

/** `{ preference, mode }`; re-renders when either changes (including OS switches in auto). */
export const useColorMode = () => useSyncExternalStore(subscribeColorMode, getSnapshot, getSnapshot)

/** `true` while the dark palette is active. */
export const useIsDarkMode = () => useColorMode().mode === COLOR_MODE_DARK

/**
 * The concrete color for the current mode. Use it wherever a real color is required
 * (Animated interpolation, canvas, three.js, charts). Non-token values pass through.
 */
export const resolveColor = (value, forMode = mode) => {
    if (typeof value !== 'string') return value
    const palette = forMode === COLOR_MODE_DARK ? DARK_PALETTE : LIGHT_PALETTE
    const match = value.match(TOKEN_VAR_RE)
    if (match) return palette[match[1]] ?? value
    const alphaMatch = value.match(/^var\(--ad-([A-Za-z0-9_]+)-a(\d+)\)$/)
    if (alphaMatch) return withAlpha(palette[alphaMatch[1]], Number(alphaMatch[2]) / 1000)
    const adaptiveMatch = value.match(ADAPTIVE_VAR_RE)
    if (adaptiveMatch) return getHighlightDisplayColor(`#${adaptiveMatch[1]}`, forMode)
    const modePair = modeVarValues.get(value)
    if (modePair) return forMode === COLOR_MODE_DARK ? modePair.dark : modePair.light
    return value
}

// ---------------------------------------------------------------------------------------------
// Stored highlight colors (task/note/goal/contact `hasStar`)
// ---------------------------------------------------------------------------------------------

const WHITE_VALUES = new Set(['#FFFFFF', '#FFF', 'WHITE', 'TRANSPARENT'])
const darkHighlightCache = new Map()

/**
 * Stored highlight colors are light pastels (white = no highlight). In dark mode they are
 * shown as a dark tint of the same hue, so the light text on top stays readable.
 */
export const getHighlightDisplayColor = (stored, forMode = mode) => {
    if (forMode !== COLOR_MODE_DARK || typeof stored !== 'string') return stored
    const key = stored.trim().toUpperCase()
    if (WHITE_VALUES.has(key)) return DARK_PALETTE.Surface
    if (!/^#[0-9A-F]{3}([0-9A-F]{3})?$/.test(key)) return stored
    if (darkHighlightCache.has(key)) return darkHighlightCache.get(key)
    const rgb = parseHex(key)
    const min = Math.min(...rgb)
    const base = parseHex(DARK_SURFACE)
    // Keep the hue (channel spread over the minimum), drop the lightness, lift a little so
    // even a grey highlight stands out from an un-highlighted row.
    const result = toHex(rgb.map((v, i) => base[i] + (v - min) * 0.75 + 14))
    darkHighlightCache.set(key, result)
    return result
}

const ADAPTIVE_VAR_RE = /^var\(--ad-hl-([0-9A-F]{6})\)$/
const registeredAdaptiveVars = new Set()

/**
 * A light background color (pastel or white) that becomes a dark tint of the same hue in dark
 * mode. Use it for hardcoded light backgrounds that have no palette token.
 */
// A one-off pair: `modeColor(lightValue, darkValue)` is a `var()` holding the light value in light
// mode (and inside popups) and the dark value in dark mode. For colours computed at runtime, such as
// a project's own colour, where no palette token fits.
const registeredModeVars = new Map()
// `var(--ad-mc-N)` -> its pair, so resolveColor() can hand Animated a concrete value.
const modeVarValues = new Map()
export const modeColor = (lightValue, darkValue) => {
    const key = `${lightValue}|${darkValue}`
    if (!registeredModeVars.has(key)) {
        const varName = `${VAR_PREFIX}mc-${registeredModeVars.size}`
        registeredModeVars.set(key, varName)
        modeVarValues.set(`var(${varName})`, { light: lightValue, dark: darkValue })
        appendDynamicVar(varName, lightValue, darkValue)
    }
    return `var(${registeredModeVars.get(key)})`
}

export const adaptiveColor = hex => {
    if (typeof hex !== 'string' || !/^#([0-9A-Fa-f]{3}){1,2}$/.test(hex.trim())) return hex
    const full = toHex(parseHex(hex.trim())).slice(1)
    const varName = `${VAR_PREFIX}hl-${full}`
    if (!registeredAdaptiveVars.has(varName)) {
        registeredAdaptiveVars.add(varName)
        appendDynamicVar(varName, `#${full}`, getHighlightDisplayColor(`#${full}`, COLOR_MODE_DARK))
    }
    return `var(${varName})`
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

injectPaletteCss()

// Light backgrounds used as `var(--ad-hl-XXXXXX, #XXXXXX)` in the plain CSS files
// (components/Anna/anna.css, the note editor toolbar, comment inputs). CSS cannot call
// adaptiveColor(), so their dark variants are registered here. Add a value when a CSS file
// starts using a new one.
const CSS_ADAPTIVE_COLORS = [
    '#D7DFF0',
    '#D7E7FF',
    '#DFE3EA',
    '#E4E9EE',
    '#E8EDFF',
    '#EAF3FF',
    '#EEF4FF',
    '#F0F0F0',
    '#F6F8FA',
    '#F6F8FC',
    '#F9FAFB',
    '#FBEFEF',
    '#FFF8DB',
]
CSS_ADAPTIVE_COLORS.forEach(adaptiveColor)

applyMode()

if (darkQuery) {
    const onSystemChange = () => {
        if (preference === COLOR_MODE_AUTO) recompute()
    }
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange)
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange)
}

if (hasDom) {
    // Another tab changed the preference.
    window.addEventListener('storage', event => {
        if (event.key === COLOR_MODE_STORAGE_KEY) {
            preference = normalizePreference(event.newValue)
            recompute()
        }
    })
}

/** Resolve every palette token of an Animated `outputRange` to a concrete color for `forMode`. */
export const resolveColors = (values, forMode = mode) => values.map(value => resolveColor(value, forMode))

/**
 * Concrete background for a value that is either a palette token or a stored light color
 * (a `hasStar` highlight, '#ffffff' for "none"): tokens resolve, stored colors get their
 * dark-mode tint. Use it where Animated needs a real color.
 */
export const resolveSurfaceColor = (value, forMode = mode) =>
    typeof value === 'string' && value.startsWith('var(')
        ? resolveColor(value, forMode)
        : getHighlightDisplayColor(value, forMode)
