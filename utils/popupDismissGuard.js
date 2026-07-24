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

const consumeEvent = event => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    event?.stopImmediatePropagation?.()
}

const consumeDismissGestureEvent = event => {
    const isTouch = event?.type?.startsWith('touch') || event?.pointerType === 'touch'
    // Keep the emulated click for touch so the one-shot trailing guard can
    // consume it and then get out of the way before the next tap.
    if (!isTouch) event?.preventDefault?.()
    event?.stopPropagation?.()
    event?.stopImmediatePropagation?.()
}

const isInNewerPopover = (popupElement, target) => {
    if (!popupElement?.closest || !target?.closest) return false

    const popupContainer = popupElement.closest('.react-tiny-popover-container')
    const targetContainer = target.closest('.react-tiny-popover-container')
    if (!targetContainer || popupContainer === targetContainer) return false

    const nodeApi = popupElement.ownerDocument?.defaultView?.Node
    const popupReference = popupContainer || popupElement
    return !!(nodeApi && popupReference.compareDocumentPosition(targetContainer) & nodeApi.DOCUMENT_POSITION_FOLLOWING)
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

    const trailingEventTypes =
        eventType === 'touchend'
            ? ['mousedown', 'mouseup', 'click']
            : eventType === 'pointerup'
            ? ['mouseup', 'click']
            : ['click']
    const blockTrailingEvent = trailingEvent => {
        consumeEvent(trailingEvent)
        if (trailingEvent.type === 'click') clearClickThroughGuard()
    }
    const timeout = setTimeout(clearClickThroughGuard, CLICK_THROUGH_GUARD_TIMEOUT_MS)

    trailingEventTypes.forEach(type => window.addEventListener(type, blockTrailingEvent, true))
    removeClickThroughGuard = () => {
        clearTimeout(timeout)
        trailingEventTypes.forEach(type => window.removeEventListener(type, blockTrailingEvent, true))
    }
}

// react-tiny-popover detects outside clicks on window during the bubble phase.
// By then, React Native Web has already delivered the release to an underlying
// Touchable. Capture the complete pointer gesture while the rich-comment popup
// is open, then dismiss on release and block the trailing browser click.
export const installRichCommentOutsideDismissGuard = (popupElement, onDismiss) => {
    if (
        !popupElement ||
        typeof popupElement.contains !== 'function' ||
        typeof window === 'undefined' ||
        !window.addEventListener
    )
        return () => {}

    let outsideGestureActive = false
    let dismissed = false

    const isOutside = event => {
        const { target } = event
        return !popupElement.contains(target) && !isInNewerPopover(popupElement, target)
    }

    const captureGestureStart = event => {
        if (!isOutside(event)) return

        outsideGestureActive = true
        consumeDismissGestureEvent(event)
    }

    const captureGestureRelease = event => {
        if (!outsideGestureActive && !isOutside(event)) return

        outsideGestureActive = false
        consumeDismissGestureEvent(event)
        protectModalDismissFromClickThrough(event)
        if (!dismissed) {
            dismissed = true
            onDismiss(event)
        }
    }

    const startEventTypes = ['pointerdown', 'mousedown', 'touchstart']
    const releaseEventTypes = ['pointerup', 'mouseup', 'touchend']
    startEventTypes.forEach(type => window.addEventListener(type, captureGestureStart, true))
    releaseEventTypes.forEach(type => window.addEventListener(type, captureGestureRelease, true))

    return () => {
        startEventTypes.forEach(type => window.removeEventListener(type, captureGestureStart, true))
        releaseEventTypes.forEach(type => window.removeEventListener(type, captureGestureRelease, true))
    }
}
