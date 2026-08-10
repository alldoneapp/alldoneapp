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

// The mirror image of the guard above (AT-2236). A full-screen modal opened by a
// press covers the control that opened it, backdrop included, from its very
// first frame. react-native-web 0.21 fires `onPress` from the DOM `click`
// event, so any press the browser had already queued while the main thread was
// busy — the second tap of an impatient user on a list that is still loading,
// or a browser-duplicated tap — is delivered AFTER the modal mounted and lands
// on that backdrop, closing the modal the same instant it appeared.
//
// Such a press was physically made before the modal existed, so it cannot be a
// deliberate dismiss. `event.timeStamp` is a DOMHighResTimeStamp taken when the
// browser CREATED the event (when the user actually pressed), not when it was
// dispatched, so comparing it against the modal's open time separates the two
// cases exactly, however long the main thread was blocked.
const POPUP_OPEN_PRESS_GRACE_PERIOD_MS = 350
// A press can only be queued behind a blocked main thread for so long. Bounding
// the comparison keeps a browser whose `timeStamp` uses a different time origin
// from making the backdrop permanently unresponsive: past this, presses are
// always honoured.
const POPUP_OPEN_PRESS_MAX_QUEUE_MS = 5000

export const highResNow = () => {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

const getEventTimeStamp = event => {
    const timeStamp = event?.timeStamp ?? event?.nativeEvent?.timeStamp
    if (typeof timeStamp !== 'number' || !isFinite(timeStamp) || timeStamp <= 0) return null
    // Legacy engines report epoch milliseconds here instead of a time-origin
    // relative value; those are orders of magnitude larger than performance.now()
    // and must not be compared against it.
    return timeStamp > highResNow() + 1 ? null : timeStamp
}

export const shouldIgnorePressFromBeforeOpen = (event, openedAt) => {
    if (typeof openedAt !== 'number') return false

    const timeStamp = getEventTimeStamp(event)
    if (timeStamp !== null && timeStamp < openedAt && openedAt - timeStamp <= POPUP_OPEN_PRESS_MAX_QUEUE_MS) return true

    // Touch only, and only for the first moments: the press may carry no usable
    // timestamp (a synthetic press, an older engine), and a tap made in the few
    // frames between the modal mounting and the user actually seeing it is not a
    // deliberate dismiss either. A mouse never queues a press behind a blocked
    // main thread the way a tap does, so desktop behaviour is unchanged.
    return isTouchDevice() && highResNow() - openedAt < POPUP_OPEN_PRESS_GRACE_PERIOD_MS
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
// Touchable. Capture the complete pointer gesture while a popup is open, then
// dismiss on release and block the trailing browser click.
export const installPopupOutsideDismissGuard = (popupElement, onDismiss) => {
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
    // touchstart is scroll-blocking, so a non-passive listener makes Chrome wait
    // on it before it can scroll (and it logs a violation). consumeDismissGestureEvent
    // deliberately never calls preventDefault for touch events, so this listener can
    // be passive; the mouse/pointer ones still need to be able to preventDefault.
    const listenerOptions = type => (type === 'touchstart' ? { capture: true, passive: true } : true)

    startEventTypes.forEach(type => window.addEventListener(type, captureGestureStart, listenerOptions(type)))
    releaseEventTypes.forEach(type => window.addEventListener(type, captureGestureRelease, true))

    return () => {
        startEventTypes.forEach(type => window.removeEventListener(type, captureGestureStart, true))
        releaseEventTypes.forEach(type => window.removeEventListener(type, captureGestureRelease, true))
    }
}

// Keep the previous export for existing callers and tests.
export const installRichCommentOutsideDismissGuard = installPopupOutsideDismissGuard
