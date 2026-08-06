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
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
