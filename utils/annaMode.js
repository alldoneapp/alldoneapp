import { useSyncExternalStore } from 'react'

// The URL owns the layout, so a reload or a copied link opens the same view.
// Replacing only the current history entry keeps the workspace mounted.
const listeners = new Set()
const notify = () => listeners.forEach(listener => listener())
const subscribe = listener => {
    if (!listeners.size && typeof window !== 'undefined') window.addEventListener('popstate', notify)
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
        if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('popstate', notify)
    }
}
export function setAnnaMode(enabled) {
    if (typeof window === 'undefined') return
    const url = withAnnaMode(window.location.href, !!enabled)
    if (url !== window.location.href) window.history.replaceState(window.history.state, '', url)
    notify()
}
export const useAnnaMode = () => useSyncExternalStore(subscribe, isAnnaMode, () => false)

export function resolveAnnaMode(location) {
    if (!location) return false
    const params = new URLSearchParams(location.search || '')
    const setting = params.get('assistant')
    if (setting !== null) return setting === '1'
    // Keep existing local preview links usable without a hidden storage override.
    if (['localhost', '127.0.0.1'].includes(location.hostname) && params.has('anna')) {
        return params.get('anna') === '1'
    }
    return location.hostname === 'anna.alldone.app'
}

export const isAnnaMode = () => resolveAnnaMode(typeof window === 'undefined' ? null : window.location)

// Every app route write carries the layout along with the new workspace path.
export function withAnnaMode(url, enabled = isAnnaMode()) {
    if (typeof window === 'undefined') return url
    const target = new URL(url, window.location.href)
    if (target.origin !== window.location.origin) return url
    target.searchParams.delete('anna')
    if (enabled) target.searchParams.set('assistant', '1')
    else if (target.hostname === 'anna.alldone.app') target.searchParams.set('assistant', '0')
    else target.searchParams.delete('assistant')
    return target.href
}

// Layout parameters must not interfere with the existing route matchers or
// their feature-specific query parameters (for example note editor options).
export function withoutAnnaMode(url) {
    if (typeof url !== 'string' || !url.includes('?')) return url
    const queryStart = url.indexOf('?')
    const hashStart = url.indexOf('#')
    if (hashStart >= 0 && hashStart < queryStart) return url
    const params = new URLSearchParams(url.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart))
    if (!params.has('assistant') && !params.has('anna')) return url
    params.delete('assistant')
    params.delete('anna')
    const query = params.toString()
    return `${url.slice(0, queryStart)}${query ? `?${query}` : ''}${hashStart < 0 ? '' : url.slice(hashStart)}`
}
