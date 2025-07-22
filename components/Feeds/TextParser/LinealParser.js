import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

export default function LinealParser({ children, parentWidth, dotsStyle, innerFeed }) {
    const [showDots, setShowDots] = useState(false)
    const [dotsPosition, setDotsPosition] = useState(0)
    const [width, setWidth] = useState(0)
    const onLayout = ({ nativeEvent }) => {
        const { width: layoutWidth } = nativeEvent.layout
        const finalWidth = width > 0 ? width : layoutWidth
        setWidth(finalWidth)
        const widthEdgeOffset = innerFeed ? 66.69 : 24
        const widthDotsOffset = innerFeed ? 57 : 24
        if (width > parentWidth - widthEdgeOffset) {
            setDotsPosition(width - parentWidth + widthDotsOffset)
            setShowDots(true)
        } else {
            setShowDots(false)
        }
    }

    useEffect(() => {
        onLayout({ nativeEvent: { layout: { width: 0 } } })
    }, [parentWidth])

    return (
        <View style={localStyles.body} onLayout={onLayout}>
            {children}
            {showDots && (
                <View style={[localStyles.dotsContainer, { right: dotsPosition }]}>
                    <Text style={dotsStyle}> ...</Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    body: {
        flexDirection: 'row',
    },
    dotsContainer: {
        zIndex: 10,
        backgroundColor: 'white',
        position: 'absolute',
    },
})
