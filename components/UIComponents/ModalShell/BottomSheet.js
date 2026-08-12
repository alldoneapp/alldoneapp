import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { createPortal } from 'react-dom'

import { colors, hexColorToRGBa } from '../../styles/global'
import {
    MODAL_BACKDROP_COLOR,
    MODAL_EDGE_GAP,
    MODAL_ENTER_MS,
    MODAL_EXIT_MS,
    MODAL_SHEET_RADIUS,
    MODAL_Z_BACKDROP,
    MODAL_Z_CONTENT,
} from '../../styles/modals'
import useModalSizing from '../../../hooks/useModalSizing'
import useEscapeKey from '../../../hooks/useEscapeKey'
import { highResNow, registerPopupDismiss, shouldIgnorePressFromBeforeOpen } from '../../../utils/popupDismissGuard'
import { lockBodyScroll, unlockBodyScroll } from '../../../utils/bodyScrollLock'
import { pushSheetHistoryLayer, releaseSheetHistoryLayer } from '../../../utils/sheetHistoryLayers'
import { getSafeAreaBottomInset } from '../../../utils/safeAreaInsets'
import { ModalShellContext } from './ModalShellContext'
import {
    BOTTOM_SHEET_RELEASE_VELOCITY_WINDOW_MS,
    clampBottomSheetDrag,
    getBottomSheetReleaseVelocity,
    shouldDismissBottomSheet,
} from './bottomSheetGesture'

// Lazy on purpose: modalsManager imports the whole redux store/actions, and a
// top-level import here puts that behind every component that renders an
// AppPopover — which in jsdom flips the winner of the pre-existing
// SharedHelper <-> TranslationService import cycle and breaks unrelated
// suites at load. Only executed when a modalId is actually passed.
const getModalsManager = () => require('../../ModalsManager/modalsManager')

const SLIDE_DISTANCE = 240
// Unmount a hair after the exit animation lands so the last frame paints.
const EXIT_UNMOUNT_BUFFER_MS = 20
const HANDLE_STRIP_HEIGHT = 20
const SHEET_BOTTOM_PADDING = 8
const DRAG_SETTLE_MS = 160

const SHELL_CONTEXT_VALUE = { presentation: 'sheet' }

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// A plain object (not StyleSheet.create) on purpose: react-native-web inlines
// plain-object styles, and ModalShell.test.js asserts the inline style.
const NO_POINTER_EVENTS_STYLE = { pointerEvents: 'none' }

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The mobile popup presentation (MODAL_IMPROVEMENT_PLAN.md, Phase 2): a
 * full-width, bottom-anchored sheet in a document.body portal, with scrim,
 * drag-handle affordance, slide-up/out motion, Escape via the LIFO stack,
 * document scroll lock, safe-area padding, and keyboard awareness (the sheet
 * rides on top of the software keyboard and shrinks by its inset).
 *
 * Dismissal is the sheet's own backdrop element, NOT a window click listener —
 * which is why a nested react-tiny-popover portal opened from sheet content
 * can never accidentally dismiss the sheet (the bug class behind the
 * EmailLabelChip and RichCommentModal ad-hoc guards). The backdrop press runs
 * through shouldIgnorePressFromBeforeOpen (AT-2236: the tap that opened the
 * sheet must not also close it) and close registers a popup dismiss so the
 * trailing synthesized click cannot activate a row underneath (AT-2189
 * companion).
 *
 * Close notifies the wrapper synchronously (onRequestClose fires the moment
 * the user dismisses), but the sheet itself defers its unmount by
 * MODAL_EXIT_MS and slides out (Phase 5). The unmount is driven by a
 * setTimeout, never by the Animated completion callback — react-native-web's
 * completion callbacks are unreliable under jsdom. Wrappers that unmount the
 * whole <AppPopover> on close simply skip the exit animation, which is the
 * pre-Phase-5 behavior; nothing waits on the animation.
 */
export default function BottomSheet({ isOpen, onRequestClose, modalId, children }) {
    const { maxHeight, keyboardInset } = useModalSizing()
    // Kept true for MODAL_EXIT_MS after isOpen flips false so the slide-out
    // can play; the render gate below is this, not isOpen.
    const [isMounted, setIsMounted] = useState(!!isOpen)
    const progressRef = useRef(null)
    if (progressRef.current === null) progressRef.current = new Animated.Value(0)
    const progress = progressRef.current
    const openedAtRef = useRef(highResNow())
    const closingRef = useRef(false)

    // Dragging the handle moves the sheet vertically; a deliberate swipe down
    // dismisses it. Raw pointer events
    // on the handle's DOM node rather than PanResponder — pointer events unify
    // mouse and touch, setPointerCapture keeps the stream on the handle for
    // the whole gesture, and react-native-web's responder layer has already
    // proven undeliverable in two environments here (jsdom presses, and mouse
    // drags under Chromium touch emulation in browser-tests/modalsheet).
    const dragYRef = useRef(null)
    if (dragYRef.current === null) dragYRef.current = new Animated.Value(0)
    const dragY = dragYRef.current
    const requestCloseRef = useRef(() => {})
    const handleRef = useRef(null)
    const sheetNodeRef = useRef(null)

    const animate = (toValue, duration) => {
        Animated.timing(progress, {
            toValue,
            duration: prefersReducedMotion() ? 0 : duration,
            easing: toValue === 1 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
            useNativeDriver: false,
        }).start()
    }

    const requestClose = () => {
        if (closingRef.current) return
        closingRef.current = true
        registerPopupDismiss()
        animate(0, MODAL_EXIT_MS)
        if (onRequestClose) onRequestClose()
    }

    const onBackdropPress = event => {
        if (shouldIgnorePressFromBeforeOpen(event?.nativeEvent || event, openedAtRef.current)) return
        requestClose()
    }

    requestCloseRef.current = requestClose

    useEffect(() => {
        const node = handleRef.current
        if (!isOpen || !node) return
        let activePointerId = null
        let startY = 0
        let sheetHeight = 0
        let samples = []
        const settleDragBack = () => {
            Animated.timing(dragYRef.current, {
                toValue: 0,
                duration: prefersReducedMotion() ? 0 : DRAG_SETTLE_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }).start()
        }
        const pointerIdFor = event => (event.pointerId == null ? 'pointer' : event.pointerId)
        const finishGesture = () => {
            activePointerId = null
            samples = []
        }
        const onPointerDown = event => {
            if (activePointerId !== null || event.isPrimary === false) return
            if (event.pointerType === 'mouse' && event.button !== 0) return

            dragYRef.current.stopAnimation()
            dragYRef.current.setValue(0)
            activePointerId = pointerIdFor(event)
            startY = event.clientY
            sheetHeight = sheetNodeRef.current?.getBoundingClientRect().height || 0
            samples = [{ time: highResNow(), y: event.clientY }]
            if (node.setPointerCapture && event.pointerId != null) {
                try {
                    node.setPointerCapture(event.pointerId)
                } catch (error) {
                    // Window listeners below keep the gesture intact on
                    // browsers that expose but reject pointer capture.
                }
            }
        }
        const onPointerMove = event => {
            if (pointerIdFor(event) !== activePointerId) return
            if (event.cancelable) event.preventDefault()
            const now = highResNow()
            samples.push({ time: now, y: event.clientY })
            samples = samples.filter(sample => sample.time >= now - BOTTOM_SHEET_RELEASE_VELOCITY_WINDOW_MS)
            dragYRef.current.setValue(clampBottomSheetDrag(event.clientY - startY, sheetHeight))
        }
        const onPointerUp = event => {
            if (pointerIdFor(event) !== activePointerId) return
            const distance = event.clientY - startY
            const releasedAt = highResNow()
            const velocity = getBottomSheetReleaseVelocity(samples, releasedAt, event.clientY)
            finishGesture()
            if (shouldDismissBottomSheet(distance, velocity)) {
                requestCloseRef.current()
            } else {
                settleDragBack()
            }
        }
        const onPointerCancel = event => {
            if (pointerIdFor(event) !== activePointerId) return
            finishGesture()
            settleDragBack()
        }
        node.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointermove', onPointerMove, { passive: false })
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerCancel)
        return () => {
            node.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerCancel)
        }
        // isMounted matters: on a reopen after a full (deferred) unmount the
        // first isOpen flush runs before the handle node exists — the effect
        // must re-run once the sheet has actually rendered.
    }, [isOpen, isMounted])

    useEscapeKey(() => requestClose(), { enabled: !!isOpen })

    // Focus trap (Phase 5 a11y): while the sheet is open, Tab cycles within
    // it — the app behind the scrim is inert to the pointer, so it must be
    // inert to the keyboard too. Capture phase for the same reason as the
    // escape stack: nothing downstream can swallow the key first.
    useEffect(() => {
        if (!isOpen) return
        const onKeyDown = event => {
            if (event.key !== 'Tab') return
            const sheetNode = sheetNodeRef.current
            if (!sheetNode) return
            const focusables = Array.from(sheetNode.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
                element => element.getAttribute('aria-hidden') !== 'true'
            )
            if (focusables.length === 0) {
                event.preventDefault()
                return
            }
            const first = focusables[0]
            const last = focusables[focusables.length - 1]
            const active = document.activeElement
            if (!sheetNode.contains(active)) {
                event.preventDefault()
                first.focus()
            } else if (!event.shiftKey && active === last) {
                event.preventDefault()
                first.focus()
            } else if (event.shiftKey && active === first) {
                event.preventDefault()
                last.focus()
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
    }, [isOpen])

    // Exit choreography: when the wrapper flips isOpen off (whether via our
    // own requestClose or its own item-selection path), keep rendering while
    // the sheet slides out, then unmount. Re-opening mid-exit cancels the
    // pending unmount and the open effect below re-runs the enter animation.
    useEffect(() => {
        if (isOpen) {
            setIsMounted(true)
            return
        }
        if (!isMounted) return
        if (!closingRef.current) {
            closingRef.current = true
            animate(0, MODAL_EXIT_MS)
        }
        const exitMs = prefersReducedMotion() ? 0 : MODAL_EXIT_MS
        const timer = setTimeout(() => setIsMounted(false), exitMs + EXIT_UNMOUNT_BUFFER_MS)
        return () => clearTimeout(timer)
    }, [isOpen, isMounted])

    useEffect(() => {
        if (!isOpen) return
        openedAtRef.current = highResNow()
        closingRef.current = false
        dragYRef.current.setValue(0)
        lockBodyScroll()
        if (modalId) getModalsManager().storeModal(modalId)
        // Back-button close (Phase 5): the sheet owns one history entry; a
        // back press pops the sheet, any other dismissal releases the entry.
        const historyLayerId = pushSheetHistoryLayer(() => requestCloseRef.current())
        animate(1, MODAL_ENTER_MS)
        // Focus return: restore where the user was when the sheet closes —
        // but never to an editable element, which would pop the software
        // keyboard right after dismissing a sheet.
        const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null
        return () => {
            unlockBodyScroll()
            releaseSheetHistoryLayer(historyLayerId)
            if (modalId) getModalsManager().removeModal(modalId)
            const isEditable =
                previouslyFocused &&
                (['INPUT', 'TEXTAREA'].includes(previouslyFocused.tagName) || previouslyFocused.isContentEditable)
            if (
                previouslyFocused &&
                previouslyFocused.isConnected &&
                !isEditable &&
                typeof previouslyFocused.focus === 'function' &&
                document.activeElement === document.body
            ) {
                previouslyFocused.focus()
            }
        }
    }, [isOpen])

    if (!isMounted || typeof document === 'undefined') return null

    // While exiting, the dying sheet must neither swallow the user's next tap
    // nor deliver one to its own rows — pointer events fall through to
    // nothing (the dismiss-replay guard already covers the row underneath).
    const isExiting = !isOpen
    // The keyboard covers the safe area, so only one of the two applies.
    const bottomInset = keyboardInset > 0 ? keyboardInset : getSafeAreaBottomInset()
    const bottomPadding = SHEET_BOTTOM_PADDING
    const contentMaxHeight = Math.max(maxHeight - HANDLE_STRIP_HEIGHT - bottomPadding, 0)

    return createPortal(
        <ModalShellContext.Provider value={SHELL_CONTEXT_VALUE}>
            {/* Plain onClick rather than a Touchable: react-native-web passes it
                through to the DOM, a scrim needs no press feedback or gesture
                semantics, and the responder system does not deliver presses in
                jsdom (ModalShell.test.js drives this exact handler). */}
            <Animated.View
                testID={'bottom-sheet-backdrop'}
                onClick={onBackdropPress}
                style={[localStyles.backdrop, { opacity: progress }, isExiting && NO_POINTER_EVENTS_STYLE]}
            />
            <Animated.View
                ref={sheetNodeRef}
                testID={'bottom-sheet'}
                accessibilityRole={'dialog'}
                aria-modal={true}
                style={[
                    localStyles.sheet,
                    isExiting && NO_POINTER_EVENTS_STYLE,
                    {
                        bottom: bottomInset,
                        maxHeight: maxHeight,
                        paddingBottom: bottomPadding,
                        opacity: progress,
                        transform: [
                            {
                                translateY: Animated.add(
                                    progress.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [SLIDE_DISTANCE, 0],
                                    }),
                                    dragY
                                ),
                            },
                        ],
                    },
                ]}
            >
                <View ref={handleRef} testID={'bottom-sheet-handle'} style={localStyles.handleStrip}>
                    <View style={localStyles.handle} />
                </View>
                <View style={[localStyles.content, { maxHeight: contentMaxHeight }]}>{children}</View>
            </Animated.View>
        </ModalShellContext.Provider>,
        document.body
    )
}

const localStyles = StyleSheet.create({
    backdrop: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: MODAL_Z_BACKDROP,
        backgroundColor: MODAL_BACKDROP_COLOR,
        touchAction: 'none',
    },
    sheet: {
        position: 'fixed',
        left: 0,
        right: 0,
        zIndex: MODAL_Z_CONTENT,
        backgroundColor: colors.Secondary400,
        borderTopLeftRadius: MODAL_SHEET_RADIUS,
        borderTopRightRadius: MODAL_SHEET_RADIUS,
        overflow: 'hidden',
        alignItems: 'center',
    },
    handleStrip: {
        height: HANDLE_STRIP_HEIGHT,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        // Without this the browser competes for the vertical drag gesture.
        touchAction: 'none',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.6),
    },
    content: {
        alignSelf: 'stretch',
        alignItems: 'center',
        overflow: 'hidden',
        paddingHorizontal: MODAL_EDGE_GAP / 2,
    },
})
