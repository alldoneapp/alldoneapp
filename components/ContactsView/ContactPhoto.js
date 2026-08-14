import React, { useCallback, useState } from 'react'
import { Image, View } from 'react-native'

import Spinner from '../UIComponents/Spinner'

export default function ContactPhoto({ uri, style, spinnerContainerStyle }) {
    const [loading, setLoading] = useState(false)
    const onLoadStart = useCallback(() => setLoading(true), [])
    const onLoadEnd = useCallback(() => setLoading(false), [])

    return (
        <>
            <Image
                onLoadStart={onLoadStart}
                onLoadEnd={onLoadEnd}
                source={{ uri }}
                style={[style, { display: loading ? 'none' : 'flex' }]}
            />
            {loading &&
                (spinnerContainerStyle ? (
                    <View style={spinnerContainerStyle}>
                        <Spinner containerSize={48} spinnerSize={24} />
                    </View>
                ) : (
                    <Spinner containerSize={48} spinnerSize={24} />
                ))}
        </>
    )
}
