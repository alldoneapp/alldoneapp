import React from 'react'
import { Text } from 'react-native'

export default function Leaf({ children, elementId, style, numberOfLines, closePopover, closeModal, onClose }) {
    if (children) {
        return (
            <Text nativeID={elementId} style={style} numberOfLines={numberOfLines}>
                {children}
            </Text>
        )
    }
    const close = closePopover || closeModal || onClose
    return close ? <button onClick={close}>Close fixture popup</button> : null
}
