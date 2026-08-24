import { useEffect, useRef } from 'react'

import { highResNow } from '../utils/popupDismissGuard'
import { isReleaseInsideRect } from '../components/UIControls/pushToTalk'

/**
 * Press-and-hold gesture for the dictation mic (AT-2405), on raw DOM events.
 *
 * Why not `TouchableOpacity`'s `onPressIn`/`onPressOut`: this codebase has already been burned by
 * the react-native-web responder layer for exactly this kind of gesture — see the comment on
 * `BottomSheet.js`'s drag handle ("the RNW responder layer has proven undeliverable here"). It is
 * also undeliverable in jsdom, which would make every test of this feature a test against a
 * double. So this follows the same triple-stream shape BottomSheet settled on: Touch is the
 * primary mobile stream (some mobile WebViews deliver only Touch Events), Pointer covers modern
 * browsers, Mouse keeps desktop working, and `activeGesture` makes sure a browser that emits two
 * of them cannot start the recording twice.
 *
 * The listeners for the END of the gesture live on `window`, not on the button: releasing outside
 * the button is a first-class outcome here (it cancels the take), and a node-local `pointerup`
 * would simply never arrive for it.
 */

// Touch emits synthetic mouse events after the fact; ignore them for this long after a real touch
// so one finger cannot open a second gesture. Same constant and reasoning as BottomSheet.
export const COMPATIBILITY_MOUSE_SUPPRESSION_MS = 500

const pointFromMouse = event => ({ clientX: event.clientX, clientY: event.clientY })

const findTouch = (touchList, identifier) =>
    Array.from(touchList || []).find(touch => identifier == null || touch.identifier === identifier)

/**
 * The button's DOM node is passed as a VALUE, not a ref: the mic unmounts and remounts as it moves
 * between hidden/idle/recording, and an effect keyed on a ref object would keep its listeners
 * bound to the previous node without ever re-running. Hosts hold it with `useState` + a ref
 * callback, the same way CustomTextInput3 tracks its editor element.
 *
 * @param {HTMLElement|null} node
 * @param {{
 *   enabled?: boolean,
 *   onPressStart: () => void,
 *   onPressMove?: (travel: {dx: number, dy: number, distance: number, insideButton: boolean}) => void,
 *   onPressEnd: (release: {
 *     heldMs: number, releasedInside: boolean, cancelled: boolean,
 *     dx: number, dy: number, distance: number,
 *   }) => void,
 * }} options
 */
export default function usePushToTalkGesture(node, { enabled = true, onPressStart, onPressMove, onPressEnd }) {
    // Handlers are read through refs so a re-render (the elapsed-seconds tick fires every second
    // while recording) cannot tear the listeners down and lose the gesture in progress.
    const startRef = useRef(onPressStart)
    startRef.current = onPressStart
    const moveRef = useRef(onPressMove)
    moveRef.current = onPressMove
    const endRef = useRef(onPressEnd)
    endRef.current = onPressEnd

    useEffect(() => {
        if (!enabled || !node) return

        let activeGesture = null
        let pressedAt = 0
        let suppressMouseUntil = 0
        // Where the finger went down. Slide-to-cancel is measured from the press ORIGIN, not from
        // the button's rect: the button is 24px and the thumb covers it, so "did you leave the
        // button" is a hair-trigger the user cannot see. Travel from where they actually pressed is
        // the thing they can feel. See `pushToTalk.js` for the thresholds.
        let origin = null

        const reportTravel = point => {
            if (!activeGesture || !origin || !point || point.clientX == null) return
            const dx = point.clientX - origin.clientX
            const dy = point.clientY - origin.clientY
            moveRef.current?.({
                dx,
                dy,
                distance: Math.sqrt(dx * dx + dy * dy),
                insideButton: isReleaseInsideRect(node.getBoundingClientRect(), point),
            })
        }

        const travelFrom = point => {
            if (!origin || !point || point.clientX == null) return { dx: 0, dy: 0, distance: 0 }
            const dx = point.clientX - origin.clientX
            const dy = point.clientY - origin.clientY
            return { dx, dy, distance: Math.sqrt(dx * dx + dy * dy) }
        }

        const beginGesture = (kind, id, event, point) => {
            if (activeGesture !== null) return false
            activeGesture = { kind, id }
            origin = point && point.clientX != null ? { clientX: point.clientX, clientY: point.clientY } : null
            pressedAt = highResNow()
            // Keep the caret where it is: the editor must not lose focus or its selection because
            // the user reached for the mic. This is what the old `onMouseDown` preventDefault on
            // the TouchableOpacity did, and it is load-bearing — the transcript is inserted AT the
            // selection. On touch it additionally suppresses the long-press callout/context menu
            // and stops the press from being read as the start of a scroll.
            if (event.cancelable) event.preventDefault()
            // A mic can sit inside a draggable task row, and @hello-pangea/dnd starts a drag 120ms
            // after touchstart. Holding the mic must not drag the row out from under it.
            event.stopPropagation()
            startRef.current?.()
            return true
        }

        const finishGesture = (kind, id, point, cancelled) => {
            if (activeGesture?.kind !== kind || activeGesture.id !== id) return
            activeGesture = null
            const heldMs = highResNow() - pressedAt
            const releasedInside = cancelled ? false : isReleaseInsideRect(node.getBoundingClientRect(), point)
            const travel = travelFrom(point)
            origin = null
            endRef.current?.({ heldMs, releasedInside, cancelled: !!cancelled, ...travel })
        }

        const pointerId = event => (event.pointerId == null ? 'pointer' : event.pointerId)

        const onPointerDown = event => {
            if (event.isPrimary === false) return
            if (event.pointerType === 'mouse' && event.button !== 0) return
            if (event.pointerType === 'mouse' && highResNow() < suppressMouseUntil) return
            if (
                beginGesture('pointer', pointerId(event), event, pointFromMouse(event)) &&
                node.setPointerCapture &&
                event.pointerId != null
            ) {
                try {
                    node.setPointerCapture(event.pointerId)
                } catch (error) {
                    // The window listeners below keep the gesture intact on browsers that expose
                    // pointer capture but reject it.
                }
            }
        }
        const onPointerMove = event => {
            if (activeGesture?.kind !== 'pointer' || activeGesture.id !== pointerId(event)) return
            reportTravel(pointFromMouse(event))
        }
        const onPointerUp = event => finishGesture('pointer', pointerId(event), pointFromMouse(event), false)
        const onPointerCancel = event => finishGesture('pointer', pointerId(event), null, true)

        const onTouchStart = event => {
            const touch = findTouch(event.changedTouches)
            if (!touch) return
            suppressMouseUntil = highResNow() + COMPATIBILITY_MOUSE_SUPPRESSION_MS
            // Browsers that emit both streams send pointerdown first. Prefer the native touch
            // stream so a missing pointerup cannot leave a real finger gesture inert — a mic that
            // never stops recording is the worst failure this feature has. This is a HANDOVER of
            // the press already in flight, not a new one: re-running beginGesture here would fire
            // a second onPressStart and open the microphone twice for one finger.
            if (activeGesture?.kind === 'pointer') {
                activeGesture = { kind: 'touch', id: touch.identifier }
                if (event.cancelable) event.preventDefault()
                event.stopPropagation()
                // The handover keeps the pointer gesture's origin: it is the same finger, and
                // re-seeding from touchstart would zero out any travel already reported.
                return
            }
            beginGesture('touch', touch.identifier, event, pointFromMouse(touch))
        }
        const onTouchMove = event => {
            if (activeGesture?.kind !== 'touch') return
            const moved = findTouch(event.changedTouches, activeGesture.id) || findTouch(event.touches, activeGesture.id)
            if (!moved) return
            // Sliding to cancel must not scroll the page out from under the finger. touchstart
            // already prevented the default for this touch in most browsers; iOS is not reliable
            // about that once the finger travels, so the move is prevented too while we own it.
            if (event.cancelable) event.preventDefault()
            reportTravel(pointFromMouse(moved))
        }
        const onTouchEnd = event => {
            if (activeGesture?.kind !== 'touch') return
            const touch = findTouch(event.changedTouches, activeGesture.id)
            if (!touch) return
            suppressMouseUntil = highResNow() + COMPATIBILITY_MOUSE_SUPPRESSION_MS
            finishGesture('touch', activeGesture.id, pointFromMouse(touch), false)
        }
        const onTouchCancel = event => {
            if (activeGesture?.kind !== 'touch') return
            finishGesture('touch', activeGesture.id, null, true)
        }

        const onMouseDown = event => {
            if (event.button !== 0 || highResNow() < suppressMouseUntil) return
            beginGesture('mouse', 'mouse', event, pointFromMouse(event))
        }
        const onMouseMove = event => {
            if (activeGesture?.kind !== 'mouse') return
            reportTravel(pointFromMouse(event))
        }
        const onMouseUp = event => finishGesture('mouse', 'mouse', pointFromMouse(event), false)

        // The tab going away mid-hold has to end the take; nobody is coming back to release it.
        const onWindowBlur = () => {
            if (!activeGesture) return
            finishGesture(activeGesture.kind, activeGesture.id, null, true)
        }

        node.addEventListener('pointerdown', onPointerDown)
        node.addEventListener('touchstart', onTouchStart, { passive: false })
        node.addEventListener('mousedown', onMouseDown)
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerCancel)
        window.addEventListener('touchmove', onTouchMove, { passive: false })
        window.addEventListener('touchend', onTouchEnd)
        window.addEventListener('touchcancel', onTouchCancel)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        window.addEventListener('blur', onWindowBlur)
        return () => {
            node.removeEventListener('pointerdown', onPointerDown)
            node.removeEventListener('touchstart', onTouchStart)
            node.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerCancel)
            window.removeEventListener('touchmove', onTouchMove)
            window.removeEventListener('touchend', onTouchEnd)
            window.removeEventListener('touchcancel', onTouchCancel)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            window.removeEventListener('blur', onWindowBlur)
            // A gesture in flight at unmount never gets its release; the recorder's own unmount
            // cleanup stops the stream, so there is nothing to report here.
            activeGesture = null
            origin = null
        }
    }, [enabled, node])
}
