import React from 'react'
import { View } from 'react-native'
import useWorkspaceViewport from '../../hooks/useWorkspaceViewport'

// Global dialogs live outside the route tree. Give fixed and absolute children
// the same containing block as overlays rendered inside Alldone itself. Keep
// the wrapper mounted across zoom changes so open forms retain their state.
export default function WorkspaceOverlayLayer({ children }) {
    const viewport = useWorkspaceViewport()
    return (
        <View
            testID="workspace-overlay-layer"
            pointerEvents="box-none"
            style={
                viewport.active
                    ? {
                          position: 'fixed',
                          top: viewport.top,
                          left: viewport.left,
                          width: viewport.width,
                          height: viewport.height,
                          transform: [{ translateX: 0 }],
                          zIndex: 999,
                      }
                    : { display: 'contents' }
            }
        >
            {children}
        </View>
    )
}
