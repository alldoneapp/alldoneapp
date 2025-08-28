import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function CloseButton({ closeModal, comments }) {
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

    return (
        <View style={localStyles.closeContainer}>
            <TouchableOpacity
                disabled={!comments}
                accessibilityLabel={'social-text-block'}
                style={localStyles.closeButton}
                onPress={event => closeModal(comments && comments.length > 0 ? event : false)}
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
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
