import React from 'react'
import { StyleSheet, View } from 'react-native'

import ShowMoreButton from '../../../UIControls/ShowMoreButton'

/**
 * The links under a comment popup's thread: "open chat" opens this thread in full. "All chats"
 * (AT-3020) is there only when the caller passes `onOpenAllChats`, which only the assistant line's
 * Last comment popover does: it leads from the one thread on show to the whole Chats list.
 */
export default function CommentPopupFooter({ onOpenChat, onOpenAllChats = null }) {
    return (
        <View style={localStyles.footer}>
            <ShowMoreButton expand={onOpenChat} contract={onOpenChat} expanded={false} expandText={'open chat'} />
            {!!onOpenAllChats && (
                <ShowMoreButton
                    expand={onOpenAllChats}
                    contract={onOpenAllChats}
                    expanded={false}
                    expandText={'All chats'}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    footer: {
        flexDirection: 'row',
        marginTop: 8,
    },
})
