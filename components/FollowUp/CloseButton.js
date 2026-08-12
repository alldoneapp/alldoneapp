import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../styles/global'
import Icon from '../Icon'

export default function CloseButton({ close, style, disabledEscape }) {
    const onPress = event => {
        setTimeout(() => {
            close(event)
        })
    }

    const onKeyDown = event => {
        const { key } = event

        if (key === 'Escape') {
            close(event)
        }
    }

    useEffect(() => {
        if (!disabledEscape) {
            document.addEventListener('keydown', onKeyDown)
            return () => {
                document.removeEventListener('keydown', onKeyDown)
            }
        }
    })

    return (
        <View style={[localStyles.closeContainer, style]}>
            <TouchableOpacity style={localStyles.closeButton} onPress={onPress}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    closeContainer: {
        position: 'absolute',
        top: 13,
        right: 13,
        // react-native-web gives every View `z-index: 0` and every Text
        // `position: relative`, so the close button and the sibling title /
        // description Texts are all *positioned* boxes in the same stacking
        // context and paint in tree order. Headers that render this button
        // before their title (ModalHeader, and most modals that use
        // CloseButton directly) therefore had the full-width title box painted
        // on top of the button, swallowing the click over most of the X --
        // including its centre. Lift it above its siblings; the parent View's
        // own `z-index: 0` keeps this contained to the header.
        zIndex: 1,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
        // Grow the 24px icon to a 44px touch target without moving it or
        // affecting any caller's absolute positioning of closeContainer.
        padding: 10,
        margin: -10,
    },
})
