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
    // dark mode a raised surface lighter than the page, never the near-white of Text01.
    Snackbar: 'rgba(4, 20, 47, 0.8)',
    // Popups (FloatModals, sheets, the add-task card): navy on the light page. In dark mode the
    // same slate as the Undo bar, so every floating surface reads as one family.
    Popup: '#091540',
    PopupRaised: '#152560',
    PopupControl: '#1A3289',
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
    Snackbar: 'rgba(52, 62, 82, 0.97)',
    Popup: '#343E52',
    PopupRaised: '#3E4960',
    PopupControl: '#4A566E',
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

const injectPaletteCss = () => {
    if (!hasDom || document.getElementById(STYLE_ELEMENT_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ELEMENT_ID
    style.textContent =
        `:root{${paletteToCss(LIGHT_PALETTE)}}` +
        `:root[data-theme="dark"]{${paletteToCss(DARK_PALETTE)}color-scheme:dark;}` +
        `:root[data-theme="light"]{color-scheme:light;}`
    document.head.appendChild(style)
}

// Alpha variants are created on demand: each one becomes its own custom property with a light
// and a dark value, so `alphaColor(themed.Text03, 0.5)` still flips live.
const registeredAlphaVars = new Set()

const appendDynamicVar = (varName, lightValue, darkValue) => {
    if (!hasDom) return
    let style = document.getElementById(ALPHA_STYLE_ELEMENT_ID)
    if (!style) {
        style = document.createElement('style')
        style.id = ALPHA_STYLE_ELEMENT_ID
        document.head.appendChild(style)
    }
    style.appendChild(
        document.createTextNode(`:root{${varName}:${lightValue};}:root[data-theme="dark"]{${varName}:${darkValue};}`)
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
        appendDynamicVar(varName, withAlpha(LIGHT_PALETTE[name], alpha), withAlpha(DARK_PALETTE[name], alpha))
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
