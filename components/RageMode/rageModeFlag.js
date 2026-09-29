/**
 * Rage mode is on for everyone. The only switch left is a per-browser opt-out: opening any Alldone
 * URL with `?rageMode=off` hides the button on that browser (remembered in localStorage), and
 * `?rageMode=on` brings it back. It can never reach another user or another device.
 *
 * Every storage access is guarded: a private window, blocked site data or a thumbnail capture can
 * make localStorage throw, and a switch must never be the reason the assistant line fails to render.
 */
export const RAGE_MODE_STORAGE_KEY = 'alldone.rageMode'
export const RAGE_MODE_QUERY_PARAM = 'rageMode'

const readQueryChoice = () => {
    try {
        if (typeof window === 'undefined' || !window.location) return null
        const value = new URLSearchParams(window.location.search).get(RAGE_MODE_QUERY_PARAM)
        if (value === 'on' || value === '1' || value === 'true') return true
        if (value === 'off' || value === '0' || value === 'false') return false
    } catch (error) {
        // Unparseable location: fall through to the stored choice.
    }
    return null
}

export const isRageModeEnabled = () => {
    const fromQuery = readQueryChoice()
    try {
        const storage = typeof window !== 'undefined' ? window.localStorage : null
        if (fromQuery !== null) {
            if (storage) {
                if (fromQuery) storage.removeItem(RAGE_MODE_STORAGE_KEY)
                else storage.setItem(RAGE_MODE_STORAGE_KEY, 'off')
            }
            return fromQuery
        }
        return !storage || storage.getItem(RAGE_MODE_STORAGE_KEY) !== 'off'
    } catch (error) {
        return fromQuery !== false
    }
}
