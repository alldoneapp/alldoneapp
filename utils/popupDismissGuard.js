// Guard against mobile-web "click-through": after a tap that closes a floating
// popup/modal, the browser fires emulated mouse/click events at the same
// coordinates. With the popup unmounted, those events hit whatever sits
// underneath (e.g. a task row) and would open its edit mode. Every popup close
// is timestamped here so press handlers can ignore presses on touch devices
// for a short grace period afterwards. Must stay dependency-free — it is
// imported from redux/actions.js.

const POPUP_DISMISS_GRACE_PERIOD_MS = 500
const CLICK_THROUGH_GUARD_TIMEOUT_MS = 1000

let lastPopupDismissTime = 0
let removeClickThroughGuard = null

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

const clearClickThroughGuard = () => {
    if (removeClickThroughGuard) {
        removeClickThroughGuard()
        removeClickThroughGuard = null
    }
}

// React Native Web calls TouchableOpacity.onPress on mouseup/touchend, before
// the browser dispatches the corresponding click. If onPress unmounts a
// portal, that trailing click can be retargeted to an actionable element that
// was underneath the portal. Consume that one click at window capture level so
// it cannot reach any underlying control. Keyboard presses do not need a guard
// because they do not have a trailing pointer click.
export const protectModalDismissFromClickThrough = event => {
    event?.stopPropagation?.()

    const eventType = event?.nativeEvent?.type || event?.type
    const isPointerRelease = eventType === 'mouseup' || eventType === 'touchend' || eventType === 'pointerup'

    if (!isPointerRelease || typeof window === 'undefined' || !window.addEventListener) return

    clearClickThroughGuard()

    const blockClick = clickEvent => {
        clickEvent.preventDefault?.()
        clickEvent.stopPropagation?.()
        clickEvent.stopImmediatePropagation?.()
        clearClickThroughGuard()
    }
    const timeout = setTimeout(clearClickThroughGuard, CLICK_THROUGH_GUARD_TIMEOUT_MS)

    window.addEventListener('click', blockClick, true)
    removeClickThroughGuard = () => {
        clearTimeout(timeout)
        window.removeEventListener('click', blockClick, true)
    }
}
