import React, { useEffect, useRef } from 'react'
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
import { getSafeAreaBottomInset } from '../../../utils/safeAreaInsets'
import { ModalShellContext } from './ModalShellContext'

// Lazy on purpose: modalsManager imports the whole redux store/actions, and a
// top-level import here puts that behind every component that renders an
// AppPopover — which in jsdom flips the winner of the pre-existing
// SharedHelper <-> TranslationService import cycle and breaks unrelated
// suites at load. Only executed when a modalId is actually passed.
const getModalsManager = () => require('../../ModalsManager/modalsManager')

const SLIDE_DISTANCE = 240
const HANDLE_STRIP_HEIGHT = 20
const SHEET_BOTTOM_PADDING = 8
const SWIPE_DISMISS_DISTANCE = 96
const SWIPE_DISMISS_VELOCITY = 0.8

const SHELL_CONTEXT_VALUE = { presentation: 'sheet' }

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
 * Close is synchronous: every current wrapper unmounts the popover subtree
 * the moment it is asked to close, so an exit animation could never play —
 * notifying behind one would only add latency (and react-native-web's
 * Animated completion callbacks are unreliable under jsdom). Slide-out
 * polish is a Phase 5 item and needs wrappers that defer unmount.
 */
export default function BottomSheet({ isOpen, onRequestClose, modalId, children }) {
    const { maxHeight, keyboardInset } = useModalSizing()
    const progressRef = useRef(null)
    if (progressRef.current === null) progressRef.current = new Animated.Value(0)
    const progress = progressRef.current
    const openedAtRef = useRef(highResNow())
    const closingRef = useRef(false)

    // Swipe-down on the handle strip dismisses the sheet. Raw pointer events
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
        let startY = null
        let startedAt = 0
        const settleDragBack = () => {
            Animated.timing(dragYRef.current, { toValue: 0, duration: 120, useNativeDriver: false }).start()
        }
        const onPointerDown = event => {
            startY = event.clientY
            startedAt = highResNow()
            if (node.setPointerCapture && event.pointerId != null) node.setPointerCapture(event.pointerId)
        }
        const onPointerMove = event => {
            if (startY === null) return
            dragYRef.current.setValue(Math.max(0, event.clientY - startY))
        }
        const onPointerUp = event => {
            if (startY === null) return
            const distance = event.clientY - startY
            const elapsed = Math.max(highResNow() - startedAt, 1)
            startY = null
            // velocity in px/ms, matching the RN gesture convention
            if (distance > SWIPE_DISMISS_DISTANCE || distance / elapsed > SWIPE_DISMISS_VELOCITY) {
                requestCloseRef.current()
            } else {
                settleDragBack()
            }
        }
        const onPointerCancel = () => {
            startY = null
            settleDragBack()
        }
        node.addEventListener('pointerdown', onPointerDown)
        node.addEventListener('pointermove', onPointerMove)
        node.addEventListener('pointerup', onPointerUp)
        node.addEventListener('pointercancel', onPointerCancel)
        return () => {
            node.removeEventListener('pointerdown', onPointerDown)
            node.removeEventListener('pointermove', onPointerMove)
            node.removeEventListener('pointerup', onPointerUp)
            node.removeEventListener('pointercancel', onPointerCancel)
        }
    }, [isOpen])

    useEscapeKey(() => requestClose(), { enabled: !!isOpen })

    useEffect(() => {
        if (!isOpen) return
        openedAtRef.current = highResNow()
        closingRef.current = false
        dragYRef.current.setValue(0)
        lockBodyScroll()
        if (modalId) getModalsManager().storeModal(modalId)
        animate(1, MODAL_ENTER_MS)
        return () => {
            unlockBodyScroll()
            if (modalId) getModalsManager().removeModal(modalId)
        }
    }, [isOpen])

    if (!isOpen || typeof document === 'undefined') return null

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
                style={[localStyles.backdrop, { opacity: progress }]}
            />
            <Animated.View
                testID={'bottom-sheet'}
                style={[
                    localStyles.sheet,
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
