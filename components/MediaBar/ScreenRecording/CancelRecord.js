import React from 'react'
import { StyleSheet, View } from 'react-native'

import ConfirmDialog from '../../UIComponents/ConfirmDialog'

/**
 * "Discard this recording?" — the canonical ConfirmDialog in a window-centered
 * host. Deliberately NO scrim: this shows over a LIVE screen recording, and a
 * scrim would darken the user's screen and be captured into the video.
 * Escape backs out of the confirm (LIFO stack — it wins over ScreenRecording's
 * own Esc handler, which is what opened this); Proceed stops and discards.
 */
const CancelRecord = ({ setShowClose, closeModal }) => {
    return (
        <View style={localStyles.center}>
            <ConfirmDialog
                title={'Be careful, this action is permanent'}
                description={'Do you really want to cancel the screen recording and lose the video?'}
                closeModal={() => setShowClose(false)}
                onProceed={() => {
                    window.stopCallback && window.stopCallback()
                    closeModal()
                }}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    center: {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
    },
})

export default CancelRecord
