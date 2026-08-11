/**
 * Central Escape-to-close dispatcher (AT-2257).
 *
 * WHY THIS EXISTS
 * ---------------
 * "I should be able to press ESC on this popup (and all others) to close it."
 *
 * Almost every popup in this app already had Escape handling — the global search
 * modal has had an `if (key === 'Escape') hidePopup()` branch since 2021 — and
 * essentially none of it ran. The cause is one line in a dependency:
 *
 *     // react-native-web/dist/exports/TextInput/index.js
 *     function handleKeyDown(e) {
 *         // Prevent key events bubbling (see #612)
 *         e.stopPropagation()
 *
 * react-native-web's TextInput stops propagation of EVERY keydown, and React 18
 * attaches its synthetic listeners at the ROOT CONTAINER (`#root`) rather than at
 * `document`. Stopping propagation there stops the NATIVE event while it is still
 * inside the app tree, so it never reaches `document` or `window`.
 *
 * Every Escape-to-close listener in this codebase is registered on `document` or
 * `window`, in the BUBBLE phase: ~116 hand-rolled `document.addEventListener(
 * 'keydown', ...)` sites, `react-dismissible`'s `escape` prop (document,
 * `keyCode === 27`), `react-tiny-popover`'s `onKeyDown` (window) and
 * `react-hot-keys`/hotkeys-js (document). All of them are dead whenever focus
 * sits inside a react-native-web TextInput.
 *
 * That is not an edge case — it is the normal state of a popup. Modals autofocus
 * their field, and the search modal re-focuses it on an interval after mount, so
 * Escape was swallowed 100% of the time. Verified in real Chromium in
 * `browser-tests/at2257`: with the search field focused, Escape leaves the popup
 * open; blur the field and the very same Escape closes it.
 *
 * THE FIX IS THE PHASE, NOT THE HANDLER
 * -------------------------------------
 * This module installs ONE `keydown` listener on `document` in the CAPTURE
 * phase. Capture runs on the way DOWN, before the event ever reaches the input,
 * so nothing downstream can swallow it. Two things are built on top of it:
 *
 *  1. A LIFO STACK for components that opt in via `pushEscapeHandler` (or the
 *     `useEscapeKey` hook). The most recently mounted layer gets Escape first,
 *     which is what makes nested popups behave: the project picker opened inside
 *     the search modal closes itself, and the search modal stays open. When a
 *     handler consumes the key, propagation is stopped so no layer underneath —
 *     and no legacy bubble listener — also closes.
 *
 *  2. A LEGACY BRIDGE for the ~116 popups that are not (yet) on the stack. Their
 *     handlers are correct; they simply never receive the event. Rather than
 *     rewrite all of them, this module detects that the event was swallowed and
 *     re-emits an equivalent Escape on `document`, restoring exactly the
 *     behaviour those handlers were written against. Detection is behavioural,
 *     not a guess about which widget swallows what: a second listener on the
 *     document BUBBLE phase records whether the event completed its trip. If it
 *     did, nothing is re-emitted. This makes the bridge self-limiting — the day
 *     react-native-web stops calling `stopPropagation`, it goes quiet on its own.
 *
 * Deliberately NOT done here:
 *  - No `preventDefault()`. Escape has real default behaviour (leaving fullscreen,
 *    cancelling an IME composition, reverting a native input) and the popups only
 *    ever wanted to close themselves.
 *  - No patch to react-native-web. Its `replacement_node_modules` patch was
 *    retired on purpose in migration Stage 2; re-vendoring the package to change
 *    one line of key handling would be a large step backwards, and the capture
 *    phase solves it from application code.
 */

const ESCAPE_KEY = 'Escape'
const ESCAPE_KEY_CODE = 27
// Some browsers still report the legacy key name.
const LEGACY_ESCAPE_KEY = 'Esc'
// Marks an event this module re-emitted, so the capture listener never
// reprocesses (and never re-emits) its own event.
const REEMITTED_FLAG = '__alldoneEscapeReemitted'
// `keydown` during an IME composition reports this keyCode in every browser.
const COMPOSING_KEY_CODE = 229

// LIFO: the entry pushed last is the innermost layer and is offered the key first.
const handlers = []

let retainCount = 0
let attached = false
// Set by the bubble-phase listener when an Escape completes its trip to
// `document`, i.e. when nothing swallowed it and the legacy listeners already ran.
let escapeReachedDocument = false

const hasDom = () => typeof document !== 'undefined' && !!document.addEventListener

const isEscape = event =>
    !!event && (event.key === ESCAPE_KEY || event.key === LEGACY_ESCAPE_KEY || event.keyCode === ESCAPE_KEY_CODE)

// Escape while an input method editor is composing cancels the composition. The
// user is correcting what they are typing, not asking to close the popup.
const isComposing = event => !!(event.isComposing || event.keyCode === COMPOSING_KEY_CODE)

/**
 * Layers that own Escape themselves and always sit above whatever the stack
 * knows about. When one of these is up, this module stays out of the way
 * entirely — it neither dispatches to the stack nor re-emits — so the nested
 * control can cancel itself and the popup around it survives.
 *
 * `.ql-expanded` is Quill's open toolbar picker; the app already gates its
 * global-search shortcut on exactly this selector for the same reason
 * (`GeneralAppShortcuts.openGloablSearchModal`).
 */
const targetOwnsEscape = event => {
    const target = event.target
    if (target) {
        // A native <select> closes its own dropdown on Escape; so does a
        // datalist-backed input. Never take the key off them.
        if (target.tagName === 'SELECT') return true
        if (typeof target.closest === 'function' && target.closest('select')) return true
    }
    return !!document.querySelector('.ql-expanded')
}

/**
 * Offer the key to the stack, innermost layer first.
 *
 * A handler declines by returning exactly `false`; anything else (including
 * `undefined`, which is what a plain `() => close()` returns) counts as
 * consuming the key. Declining is the escape hatch for a layer that is mounted
 * but currently inert.
 *
 * Iterates a snapshot because a handler routinely unmounts its own component,
 * which removes entries from `handlers` while this loop is running.
 */
const dispatchToStack = event => {
    const snapshot = handlers.slice()
    for (let index = snapshot.length - 1; index >= 0; index--) {
        const entry = snapshot[index]
        if (entry.removed) continue
        if (entry.isEnabled && !entry.isEnabled()) continue
        if (entry.handler(event) !== false) return true
    }
    return false
}

/**
 * Re-emit a swallowed Escape on `document` so the popups that are still using
 * their own bubble-phase listeners behave as they always meant to.
 *
 * The synthesized event has to satisfy every dialect in the tree: most app code
 * reads `event.key`, `react-dismissible` reads `event.keyCode === 27` and
 * hotkeys-js reads `event.keyCode` too. `KeyboardEvent`'s constructor silently
 * ignores `keyCode`/`which`, so both are defined by hand.
 */
const reEmitEscape = source => {
    if (typeof KeyboardEvent !== 'function') return

    const event = new KeyboardEvent('keydown', {
        key: ESCAPE_KEY,
        code: 'Escape',
        bubbles: true,
        cancelable: true,
        ctrlKey: !!source.ctrlKey,
        altKey: !!source.altKey,
        shiftKey: !!source.shiftKey,
        metaKey: !!source.metaKey,
    })
    Object.defineProperty(event, 'keyCode', { get: () => ESCAPE_KEY_CODE })
    Object.defineProperty(event, 'which', { get: () => ESCAPE_KEY_CODE })
    event[REEMITTED_FLAG] = true

    document.dispatchEvent(event)
}

const onCaptureKeyDown = event => {
    if (!isEscape(event)) return
    // Our own replay: let it run the legacy listeners and nothing else.
    if (event[REEMITTED_FLAG]) return
    if (isComposing(event)) return
    if (targetOwnsEscape(event)) return

    if (dispatchToStack(event)) {
        // The innermost layer took it. Stop here so no layer underneath, and no
        // legacy bubble listener, closes as well — and so the bridge below sees
        // nothing to repair.
        event.stopPropagation()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        return
    }

    // Nothing on the stack wanted it. Give the event its normal trip; if it never
    // arrives at `document`, something swallowed it and the legacy listeners
    // never ran, so replay it for them.
    escapeReachedDocument = false
    setTimeout(() => {
        if (escapeReachedDocument) return
        reEmitEscape(event)
    }, 0)
}

const onBubbleKeyDown = event => {
    if (isEscape(event)) escapeReachedDocument = true
}

const attach = () => {
    if (attached || !hasDom()) return
    document.addEventListener('keydown', onCaptureKeyDown, true)
    document.addEventListener('keydown', onBubbleKeyDown, false)
    attached = true
}

const detach = () => {
    if (!attached) return
    document.removeEventListener('keydown', onCaptureKeyDown, true)
    document.removeEventListener('keydown', onBubbleKeyDown, false)
    attached = false
}

const retain = () => {
    retainCount += 1
    if (retainCount === 1) attach()
}

const release = () => {
    retainCount = Math.max(0, retainCount - 1)
    if (retainCount === 0) detach()
}

/**
 * Keep the dispatcher installed for the lifetime of the app.
 *
 * Called once from `AppNavigator`'s `AppContainer` — the one component that
 * mounts once for the whole app and already owns the app's document-level
 * listeners — so the legacy bridge is live even before any component opts into
 * the stack.
 *
 * @returns {() => void} uninstall (reference counted; safe to call once)
 */
export const installEscapeStack = () => {
    retain()
    let released = false
    return () => {
        if (released) return
        released = true
        release()
    }
}

/**
 * Register a layer that closes on Escape. The most recently registered enabled
 * layer wins, so a popup opened from inside another popup closes first.
 *
 * @param {(event: KeyboardEvent) => boolean|void} handler close this layer;
 *        return exactly `false` to decline and pass the key to the layer below.
 * @param {{ isEnabled?: () => boolean }} [options] `isEnabled` is consulted at
 *        keypress time, so a layer can go inert without re-registering (which
 *        would move it back to the top of the stack).
 * @returns {() => void} unregister
 */
export const pushEscapeHandler = (handler, options = {}) => {
    const entry = { handler, isEnabled: options.isEnabled, removed: false }
    handlers.push(entry)
    retain()

    return () => {
        if (entry.removed) return
        entry.removed = true
        const index = handlers.indexOf(entry)
        if (index !== -1) handlers.splice(index, 1)
        release()
    }
}

/** Test seam: number of layers currently registered. */
export const getEscapeStackSize = () => handlers.length

/** Test seam: drop every registration and detach the listeners. */
export const resetEscapeStack = () => {
    handlers.length = 0
    retainCount = 0
    escapeReachedDocument = false
    detach()
}
