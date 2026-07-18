import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Platform, View } from 'react-native'

import { installRichCommentOutsideDismissGuard } from '../../../../utils/popupDismissGuard'

export default function RichCommentDismissSurface({ children, disabled, onDismiss }) {
    const surfaceRef = useRef()

    useEffect(() => {
        if (disabled || Platform.OS !== 'web') return

        // React Native Web 0.11 exposes a View component instance here, while
        // the capture guard needs the rendered element for contains().
        const surfaceElement = ReactDOM.findDOMNode(surfaceRef.current)
        return installRichCommentOutsideDismissGuard(surfaceElement, onDismiss)
    }, [disabled, onDismiss])

    return <View ref={surfaceRef}>{children}</View>
}
