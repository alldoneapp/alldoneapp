import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../styles/global'
import Icon from '../Icon'
import { openViewInNewWindow } from '../../utils/openInNewWindow'

export default function OpenInNewWindowButton({ disabled = false, style }) {
    // Inside an installed desktop PWA a plain window.open would spawn a second app window
    // instead of a browser tab — see utils/openInNewWindow.js (AT-2345).
    const openUrl = () => {
        return openViewInNewWindow()
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
