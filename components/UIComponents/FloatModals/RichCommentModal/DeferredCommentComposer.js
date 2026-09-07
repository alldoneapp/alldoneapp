import React from 'react'
import { StyleSheet, View } from 'react-native'

import useProgressiveReveal from '../../../../hooks/useProgressiveReveal'

/**
 * Keeps the desktop popup shell in the opening paint and mounts the Quill
 * composer after that paint. On mobile the composer must still mount inside
 * the opening tap so the browser is allowed to raise the software keyboard.
 */
export default function DeferredCommentComposer({ children, defer, resetKey, schedule }) {
    const { visibleAmount } = useProgressiveReveal(1, {
        initialAmount: defer ? 0 : 1,
        batchSize: 1,
        resetKey: `${resetKey}:${defer ? 'deferred' : 'immediate'}`,
        schedule,
    })

    return visibleAmount > 0 ? (
        children
    ) : (
        <View
            testID="comment-composer-placeholder"
            accessibilityLabel="Loading comment editor"
            style={localStyles.placeholder}
        />
    )
}

const localStyles = StyleSheet.create({
    placeholder: {
        minHeight: 70,
    },
})
