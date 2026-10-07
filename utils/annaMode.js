import { useSyncExternalStore } from 'react'

// Layout changes never navigate or remount the workspace. The override is scoped to this tab.
const listeners = new Set()
let override
const subscribe = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
export function setAnnaMode(enabled) {
    override = !!enabled
    listeners.forEach(listener => listener())
}
export const useAnnaMode = () => useSyncExternalStore(subscribe, isAnnaMode, () => false)

// A separate entry point into the same application and authenticated data.
// The local switch is session-scoped so normal app URLs keep working in previews.
export function resolveAnnaMode(location, storage) {
    if (!location) return false
    if (location.hostname === 'anna.alldone.app') return true
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return false
    const setting = new URLSearchParams(location.search || '').get('anna')
    try {
        if (setting !== null) storage?.setItem('alldone.annaMode', setting === '1' ? '1' : '0')
        return setting !== null ? setting === '1' : storage?.getItem('alldone.annaMode') === '1'
    } catch (_) {
        return setting === '1'
    }
}

export const isAnnaMode = () => {
    if (override !== undefined) return override
    if (typeof window === 'undefined') return false
    let storage
    try {
        storage = window.sessionStorage
    } catch (_) {
        /* Storage can be unavailable in restricted browsers. */
    }
    return resolveAnnaMode(window.location, storage)
}
