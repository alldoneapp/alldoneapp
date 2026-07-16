import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { protectModalDismissFromClickThrough } from '../../../../utils/popupDismissGuard'

export default function CloseButton({ closeModal, comments, openChat }) {
    const onKeyDown = event => {
        const { key } = event

        if (key === 'Escape') {
            closeModal(event)
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const closeFromButton = event => {
        protectModalDismissFromClickThrough(event)
        closeModal(comments && comments.length > 0 ? event : false)
    }

    return (
        <View style={localStyles.closeContainer}>
            {openChat && (
                <TouchableOpacity
                    accessibilityLabel={'open-chat'}
                    style={[localStyles.closeButton, localStyles.openChatButton]}
                    onPress={openChat}
                >
                    <Icon accessibilityLabel={'open-chat'} name="maximize-2" size={20} color={colors.Text03} />
                </TouchableOpacity>
            )}
            <TouchableOpacity
                disabled={!comments}
                accessibilityLabel={'social-text-block'}
                style={localStyles.closeButton}
                onPress={closeFromButton}
            >
                <Icon accessibilityLabel={'social-text-block'} name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    closeContainer: {
        position: 'absolute',
        top: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 4,
        backgroundColor: colors.Secondary300,
    },
    openChatButton: {
        marginRight: 8,
    },
})
