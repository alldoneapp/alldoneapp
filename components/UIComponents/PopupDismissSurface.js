import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Platform, View } from 'react-native'

import { installPopupOutsideDismissGuard } from '../../utils/popupDismissGuard'
import { useModalShellPresentation } from './ModalShell/ModalShellContext'

export default function PopupDismissSurface({ children, disabled, onDismiss }) {
    const surfaceRef = useRef()
    // Inside a bottom sheet the shell chrome (handle strip, backdrop) sits
    // OUTSIDE this surface, so the window-capture guard would swallow the
    // handle's touchstart (the drag never starts) and dismiss on release.
    // The sheet owns dismissal there — backdrop, Escape and handle drag.
    const inSheet = useModalShellPresentation() === 'sheet'

    useEffect(() => {
        if (disabled || inSheet || Platform.OS !== 'web') return

        // React Native Web 0.11 exposes a View component instance here, while
        // the capture guard needs the rendered element for contains().
        const surfaceElement = ReactDOM.findDOMNode(surfaceRef.current)
        let removeOutsideDismissGuard
        // A Touchable can mount the popup on pointer/touch release. Let that
        // opening gesture (including mobile compatibility mouse events) finish
        // before treating pointer events outside the surface as a dismissal.
        const installTimeout = setTimeout(() => {
            removeOutsideDismissGuard = installPopupOutsideDismissGuard(surfaceElement, onDismiss)
        })

        return () => {
            clearTimeout(installTimeout)
            removeOutsideDismissGuard?.()
        }
    }, [disabled, inSheet, onDismiss])

    return <View ref={surfaceRef}>{children}</View>
}
