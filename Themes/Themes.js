import { get } from 'lodash'
export const COLORS_THEME_DEFAULT = 'default'
export const COLORS_THEME_MODERN = 'modern'
export const COLORS_THEME_DARK = 'dark'

export const getTheme = (Themes, themeName = COLORS_THEME_MODERN, path) => {
    return path ? get(Themes[themeName], path) : Themes[themeName]
}

export const getStyleP = (baseStyle, theme, path) => {
    return { ...baseStyle, ...get(theme, path, {}) }
}

export const getStyle = (baseStyle, theme, key) => {
    return { ...baseStyle[key], ...(theme[key] || {}) }
}
