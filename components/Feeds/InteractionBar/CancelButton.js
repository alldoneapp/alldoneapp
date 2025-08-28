import React from 'react'
import { Text, TouchableOpacity, StyleSheet } from 'react-native'

import { colors, em2px } from '../../styles/global'
import Icon from '../../Icon'

export default function CancelButton({ text, setShowInteractionBar, isMiddleScreen }) {
    const closeInteractionBar = () => {
        setShowInteractionBar(false)
    }
    return (
        <TouchableOpacity
            style={[localStyles.button, isMiddleScreen ? localStyles.buttonMobile : null]}
            onPress={closeInteractionBar}
        >
            {isMiddleScreen ? (
                <Icon name="x" color={colors.Text01} size={24} />
            ) : (
                <Text style={localStyles.text}>{text}</Text>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        height: 40,
        width: 95,
        borderRadius: 4,
        backgroundColor: '#EAF0F5',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    buttonMobile: {
        width: 40,
        paddingHorizontal: 8,
    },
    text: {
        color: colors.Text01,
        fontFamily: 'Roboto-Medium',
        fontWeight: '500',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
})
