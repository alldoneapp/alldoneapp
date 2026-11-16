import { useEffect, useLayoutEffect, useState } from 'react'
import { SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED } from '../styles/global'

export const MIN_CHAT_WIDTH = 340
const DEFAULT_CHAT_WIDTH = 420
const MAX_CHAT_WIDTH = 720
// The grid column between the chat card and the screen (anna.css, "Two cards").
const DIVIDER_WIDTH = 14
// Beside the chat Alldone keeps its desktop sidebar, collapsed where needed (responsiveLayout.js),
// which takes the width at which the plain app switches to mobile navigation with that sidebar.
const MIN_ALLDONE_WIDTH = SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED + 1

// Mirrors --anna-workspace-gutter in anna.css: the white margin inside the screen's bezel.
const workspaceGutter = windowWidth =>
    windowWidth <= 1100
        ? Math.min(24, Math.max(16, windowWidth * 0.025))
        : Math.min(48, Math.max(24, windowWidth * 0.035))

// Around Alldone the screen adds its right margin (10), its bezel (2 × 6) and two gutters.
export const minWorkspaceWidth = windowWidth => MIN_ALLDONE_WIDTH + 10 + 12 + 2 * workspaceGutter(windowWidth)

// Save the preferred width, not the temporary clamp applied in a narrow window. `splitFits`: the
// window has room for the chat beside Alldone at all; AnnaShell shows one or the other otherwise.
export default function useAnnaChatWidth(userId, layout) {
    const key = `anna-chat-width:${userId}`
    const [preferredWidth, setPreferredWidth] = useState(() => {
        try {
            const saved = Number(window.localStorage.getItem(key))
            if (saved >= MIN_CHAT_WIDTH && saved <= MAX_CHAT_WIDTH) return saved
        } catch (_) {
            // Private browsing may disable storage.
        }
        return DEFAULT_CHAT_WIDTH
    })
    const [{ availableWidth, windowWidth }, setWidths] = useState(() => ({
        availableWidth: window.innerWidth,
        windowWidth: window.innerWidth,
    }))
    useLayoutEffect(() => {
        const measure = () =>
            setWidths(current => {
                const next = {
                    availableWidth: layout.current?.getBoundingClientRect().width || window.innerWidth,
                    windowWidth: window.innerWidth,
                }
                return next.availableWidth === current.availableWidth && next.windowWidth === current.windowWidth
                    ? current
                    : next
            })
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        if (layout.current) observer?.observe(layout.current)
        window.addEventListener('resize', measure)
        measure()
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [layout])
    useEffect(() => {
        try {
            window.localStorage.setItem(key, String(preferredWidth))
        } catch (_) {
            // Layout changes still work without storage.
        }
    }, [key, preferredWidth])
    const room = availableWidth - DIVIDER_WIDTH - minWorkspaceWidth(windowWidth)
    const maximum = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, room))
    const width = Math.min(preferredWidth, maximum)
    const resize = value => setPreferredWidth(Math.max(MIN_CHAT_WIDTH, Math.min(maximum, value)))
    return { width, maximum, resize, splitFits: room >= MIN_CHAT_WIDTH }
}
