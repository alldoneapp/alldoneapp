import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../styles/global'
import Icon from '../Icon'

export default function OpenInNewWindowButton({ disabled = false, style }) {
    const openUrl = () => {
        return window.open(window.location, '_blank')
    }
    return (
        <TouchableOpacity
            onPress={openUrl}
            disabled={disabled}
            style={[localStyles.container, style]}
            accessible={false}
        >
            <Icon name={'new-window'} size={18} color={colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 7,
    },
})
