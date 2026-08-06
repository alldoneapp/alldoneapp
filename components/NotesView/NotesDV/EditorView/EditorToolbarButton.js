import React from 'react'
import { View } from 'react-native'

const EditorToolbarButton = ({ children, ...buttonProps }) => {
    return (
        <button {...buttonProps}>
            <View style={{ flexDirection: 'row', maxHeight: 20 }}>{children}</View>
        </button>
    )
}

export default EditorToolbarButton
