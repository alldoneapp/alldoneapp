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
// first frame. react-native-web 0.21 fires `onPress` from the DOM `click` event
// (PressResponder invokes onPress from onClick/keyup only) and the browser
// hit-tests every press at dispatch time, so a press aimed at the control is
// delivered to whatever the modal has since put under the finger.
//
// Measured in real Chromium with real touch input, against a react-native-web
// button that mounts a full-screen backdrop on press:
//   * ONE tap never dismisses — the modal opens on that tap's own click and no
//     further event follows, even with the main thread blocked for 400ms.
//   * TWO taps 120ms apart do: the second tap hit-tests onto the backdrop that
//     the first one had just mounted (touchstart/click target=backdrop) and
//     closes the modal ~135ms after it appeared.
// That second tap is what a still-loading, unresponsive list provokes, and it is
// the reported symptom: the popup appears and is gone again.
//
// Two rules, because the tap can predate the modal in two different ways:
//  1. A press the browser had already QUEUED while the main thread was blocked
//     carries a `timeStamp` from before the modal opened. `event.timeStamp` is a
//     DOMHighResTimeStamp taken when the browser CREATED the event — when the
//     user actually pressed — not when it was dispatched, so the comparison is
//     exact however long the thread was blocked.
//  2. A repeat tap made after the modal mounted but before the user could
//     possibly have seen and reacted to it. Perceive-decide-move is ~500ms at
//     best, and in the measurement above the repeat came 135ms in, so the window
//     is set above both and well below any deliberate dismiss.
const POPUP_OPEN_PRESS_GRACE_PERIOD_MS = 750
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

    // Rule 2, touch only: a tap this soon after the modal appeared is a repeat of
    // the tap that opened it, not a dismiss — nobody can read a modal and decide
    // to close it that fast. This also covers a press carrying no usable
    // timestamp at all. A mouse gives instant hover/press feedback and is not
    // repeat-clicked the way an unresponsive touch target is, so desktop
    // behaviour is deliberately left unchanged.
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
