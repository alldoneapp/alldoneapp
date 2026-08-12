/**
 * Mobile back-button integration for bottom sheets
 * (MODAL_IMPROVEMENT_PLAN.md, Phase 5).
 *
 * Every open BottomSheet pushes one same-URL history entry carrying a
 * sentinel state and registers itself on a LIFO stack. A browser/hardware
 * back press then consumes the topmost layer — the sheet closes and the app
 * does NOT navigate — because AppContent's `window.onpopstate` runs through
 * `withSheetHistoryLayers(SharedHelper.onHistoryPop)`: the wrapper eats the
 * pop while a layer is open and falls through to the URLSystem handler
 * otherwise. This deliberately does not touch `SharedHelper.onHistoryPop`
 * itself: the in-app back *buttons* call it directly with a `commonPath`
 * string and must keep navigating even while nothing is open.
 *
 * A sheet dismissed any other way (backdrop, Escape, item selection) still
 * owns a sentinel entry on top of the history stack; its release pops that
 * entry with `history.back()` and swallows the resulting popstate, so the
 * user's next real back press is not spent on a ghost entry. If the app
 * navigated while the sheet was open (the sentinel is no longer on top),
 * the layer is simply dropped — unwinding then would eat a real entry.
 */

let layerStack = [] // { id, close }
let consumedIds = new Set()
let suppressNextPop = false
let counter = 0

const sentinelKey = '__alldoneSheetLayer'

/** True when the popstate was ours (a sheet layer or our own unwind). */
export const consumePopstateForSheetLayers = () => {
    if (suppressNextPop) {
        suppressNextPop = false
        return true
    }
    const layer = layerStack.pop()
    if (!layer) return false
    consumedIds.add(layer.id)
    layer.close()
    return true
}

/** Wraps the app's popstate handler; sheets get the event first. */
export const withSheetHistoryLayers = fallback => event => {
    if (consumePopstateForSheetLayers()) return
    return fallback(event)
}

/**
 * Called when a sheet opens. Returns the layer id the sheet must release on
 * close. `close` is invoked when a back press consumes the layer.
 */
export const pushSheetHistoryLayer = close => {
    const id = `sheet-${++counter}`
    layerStack.push({ id, close })
    try {
        window.history.pushState({ [sentinelKey]: id }, '', window.location.href)
    } catch (error) {
        // Some embedded/headless contexts throttle pushState; the sheet still
        // works, only without back-button close.
    }
    return id
}

/** Called when a sheet closes for any reason (idempotent). */
export const releaseSheetHistoryLayer = id => {
    if (consumedIds.has(id)) {
        // A back press already consumed both the layer and its history entry.
        consumedIds.delete(id)
        return
    }
    const index = layerStack.findIndex(layer => layer.id === id)
    if (index === -1) return
    layerStack.splice(index, 1)
    const state = typeof window !== 'undefined' && window.history ? window.history.state : null
    if (state && state[sentinelKey] === id) {
        suppressNextPop = true
        window.history.back()
    }
}

/** Test seam. */
export const resetSheetHistoryLayers = () => {
    layerStack = []
    consumedIds = new Set()
    suppressNextPop = false
}
