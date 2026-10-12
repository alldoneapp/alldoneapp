import { useEffect, useLayoutEffect, useState } from 'react'

export const MIN_CHAT_WIDTH = 340
const DEFAULT_CHAT_WIDTH = 420
const MAX_CHAT_WIDTH = 720
const MIN_WORKSPACE_WIDTH = 360

// Save the preferred width, not the temporary clamp applied in a narrow window.
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
    const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth)
    useLayoutEffect(() => {
        const measure = () => setAvailableWidth(layout.current?.getBoundingClientRect().width || window.innerWidth)
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
    const maximum = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, availableWidth - MIN_WORKSPACE_WIDTH - 6))
    const width = Math.min(preferredWidth, maximum)
    const resize = value => setPreferredWidth(Math.max(MIN_CHAT_WIDTH, Math.min(maximum, value)))
    return { width, maximum, resize }
}
