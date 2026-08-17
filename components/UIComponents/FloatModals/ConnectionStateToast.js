import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ConnectionStateModal from './ConnectionStateModal'
import { getSafeAreaInsets } from '../../../utils/safeAreaInsets'

/**
 * Single global mount for the online/offline toast (notes follow-ups). It used
 * to render only inside the notes editor with a hardcoded desktop offset —
 * anywhere else in the app the connectivity change was invisible, and on
 * phones the card overlapped the editor content. Now it rides the app-wide
 * `connectionState` slice from GlobalModalsContainerApp: bottom-right card on
 * desktop, safe-area-aware full-width banner above the bottom edge on phones.
 *
 * Dismissal is per state: closing the offline toast keeps it closed while the
 * connection stays offline; any transition shows the toast again (the online
 * one also auto-closes after 5s inside ConnectionStateModal).
 */
export default function ConnectionStateToast() {
    const connectionState = useSelector(state => state.connectionState)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [dismissedState, setDismissedState] = useState('')

    useEffect(() => {
        setDismissedState('')
    }, [connectionState])

    const visible =
        (connectionState === 'online' || connectionState === 'offline') && connectionState !== dismissedState
    if (!visible) return null

    const safeAreaBottom = getSafeAreaInsets().bottom
    const wrapperStyle = mobile
        ? { position: 'fixed', zIndex: 100000, left: 16, right: 16, bottom: 16 + safeAreaBottom, alignItems: 'center' }
        : { position: 'fixed', zIndex: 100000, right: 24, bottom: 24 + safeAreaBottom, width: 320 }

    return (
        <View style={wrapperStyle} pointerEvents="box-none">
            <ConnectionStateModal
                connectionState={connectionState}
                closeModal={() => setDismissedState(connectionState)}
            />
        </View>
    )
}
