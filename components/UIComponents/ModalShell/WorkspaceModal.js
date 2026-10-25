import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { View } from 'react-native'
import WorkspaceOverlayLayer from '../WorkspaceOverlayLayer'
import useEscapeKey from '../../../hooks/useEscapeKey'

// For standalone dialogs whose contents already provide the scrim and card.
// The same portal stays mounted through zoom changes, just like AppPopover.
export default function WorkspaceModal({ children, visible, onRequestClose }) {
    const dialog = useRef(null)
    useEscapeKey(onRequestClose, { enabled: visible })
    useEffect(() => {
        if (!visible) return
        const previous = document.activeElement
        dialog.current?.focus({ preventScroll: true })
        return () => {
            if (previous?.isConnected && document.activeElement === document.body)
                previous.focus({ preventScroll: true })
        }
    }, [visible])
    if (!visible || typeof document === 'undefined') return null
    return createPortal(
        <WorkspaceOverlayLayer>
            <View ref={dialog} role="dialog" tabIndex={-1} style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
                {children}
            </View>
        </WorkspaceOverlayLayer>,
        document.body
    )
}
