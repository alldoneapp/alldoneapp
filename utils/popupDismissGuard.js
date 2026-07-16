// Guard against mobile-web "click-through": after a tap that closes a floating
// popup/modal, the browser fires emulated mouse/click events at the same
// coordinates. With the popup unmounted, those events hit whatever sits
// underneath (e.g. a task row) and would open its edit mode. Every popup close
// is timestamped here so press handlers can ignore presses on touch devices
// for a short grace period afterwards. Must stay dependency-free — it is
// imported from redux/actions.js.

const POPUP_DISMISS_GRACE_PERIOD_MS = 500

let lastPopupDismissTime = 0

const isTouchDevice = () => {
    return (
        typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
    )
}

export const registerPopupDismiss = () => {
    lastPopupDismissTime = Date.now()
}

export const shouldBlockPressAfterPopupDismiss = () => {
    return isTouchDevice() && Date.now() - lastPopupDismissTime < POPUP_DISMISS_GRACE_PERIOD_MS
}
