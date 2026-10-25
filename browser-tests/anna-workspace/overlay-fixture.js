import React, { useState } from 'react'
import { View } from 'react-native'
import AppPopover from '../../components/UIComponents/ModalShell/AppPopover'
import WorkspaceOverlayLayer from '../../components/UIComponents/WorkspaceOverlayLayer'
import ConnectionStateToast from '../../components/UIComponents/FloatModals/ConnectionStateToast'
import undoStyles, { getUndoOverlayPosition } from '../../components/Undo/undoActionBarStyles'
import useModalSizing from '../../hooks/useModalSizing'
import { useFixedModalOverlayPadding } from '../../hooks/useSafeAreaOverlayPadding'
import { fixedModalOverlayStyle } from '../../utils/fixedModalPosition'
import { centerPopoverInWindow } from '../../utils/popoverPositioning'
import useEscapeKey from '../../hooks/useEscapeKey'

function PopupForm({ close }) {
    useEscapeKey(close)
    const { width, maxHeight } = useModalSizing()
    return (
        <div
            data-testid="popup-form"
            style={{
                width,
                maxHeight,
                padding: 24,
                boxSizing: 'border-box',
                background: '#1e304f',
                color: 'white',
                borderRadius: 8,
            }}
        >
            <h2>Workspace popup</h2>
            <p>This form follows Alldone's available width.</p>
            <input
                aria-label="Popup draft"
                defaultValue="Unsaved popup"
                style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <p>Keep this draft while resizing the workspace.</p>
        </div>
    )
}
export function OverlayLaunchers({ openGlobal, toggleNotifications }) {
    const [popup, setPopup] = useState(false)
    const [centered, setCentered] = useState(false)
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
            <button onClick={openGlobal}>Open global dialog</button>
            <button onClick={toggleNotifications}>Toggle notifications</button>
            <AppPopover
                isOpen={popup}
                position={['left']}
                disableReposition
                onClickOutside={() => setPopup(false)}
                content={<PopupForm close={() => setPopup(false)} />}
                contentLocation={centered ? centerPopoverInWindow : undefined}
                containerStyle={{ zIndex: 10000 }}
            >
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        onClick={() => {
                            setCentered(false)
                            setPopup(true)
                        }}
                    >
                        Open anchored popup
                    </button>
                    <button
                        onClick={() => {
                            setCentered(true)
                            setPopup(true)
                        }}
                    >
                        Open centered popup
                    </button>
                </div>
            </AppPopover>
        </div>
    )
}
export function GlobalOverlayFixture({ dialog, notifications, closeDialog }) {
    const { width, maxHeight, safeAreaInsets } = useModalSizing()
    const padding = useFixedModalOverlayPadding()
    return (
        <WorkspaceOverlayLayer>
            {notifications && (
                <>
                    <ConnectionStateToast />
                    <View
                        testID="undo-notification"
                        style={[undoStyles.overlay, getUndoOverlayPosition(safeAreaInsets)]}
                    >
                        <View style={undoStyles.container}>
                            <span style={{ color: 'white' }}>Task completed · Undo</span>
                        </View>
                    </View>
                </>
            )}
            {dialog && (
                <View
                    testID="global-dialog-overlay"
                    style={[
                        fixedModalOverlayStyle,
                        padding,
                        { alignItems: 'center', zIndex: 9999, backgroundColor: 'rgba(0,0,0,.25)' },
                    ]}
                >
                    <div
                        data-testid="global-dialog-card"
                        style={{
                            width,
                            maxHeight,
                            padding: 24,
                            boxSizing: 'border-box',
                            background: '#1e304f',
                            color: 'white',
                            borderRadius: 8,
                        }}
                    >
                        <h2>Global Alldone dialog</h2>
                        <input aria-label="Global dialog draft" defaultValue="Keep this global draft" />
                        <button onClick={closeDialog}>Close dialog</button>
                    </div>
                </View>
            )}
        </WorkspaceOverlayLayer>
    )
}
