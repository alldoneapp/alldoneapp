import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MyPlatform from '../../MyPlatform'
import { colors } from '../../styles/global'

export default function AactiveIndicator({ options, optionsRefs, currentIndex }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const width = useRef(new Animated.Value(0)).current
    const position = useRef(new Animated.Value(0)).current

    const getOffset = widths => {
        let width = 0
        for (let i = 0; i < currentIndex; i++) {
            width += widths[i]
        }

        return width
    }

    const animate = widths => {
        const posValue = getOffset(widths)

        const animation = Animated.parallel(
            [
                Animated.timing(position, {
                    toValue: posValue,
                    duration: 300,
                    // left/width are layout props, so the native driver cannot drive them.
                    useNativeDriver: false,
                }),
                Animated.timing(width, {
                    toValue: widths[currentIndex],
                    duration: 200,
                    useNativeDriver: false,
                }),
            ],
            { stopTogether: false }
        )
        animation.start()
        return animation
    }

    useEffect(() => {
        let cancelled = false
        let animation

        const updateWidths = async () => {
            const widths = await Promise.all(optionsRefs.map(optionRef => MyPlatform.getElementWidth(optionRef)))
            if (cancelled) return

            animation = animate(widths)
        }

        updateWidths()

        return () => {
            cancelled = true
            animation?.stop()
        }
    }, [currentIndex, smallScreenNavigation, JSON.stringify(options), optionsRefs])

    return (
        <Animated.View style={[localStyles.activeIndicator, { width: width, transform: [{ translateX: position }] }]} />
    )
}

const localStyles = StyleSheet.create({
    activeIndicator: {
        position: 'absolute',
        height: 22,
        width: 50,
        backgroundColor: colors.Grey100,
        borderRadius: 12,
        boxShadow: '0px 0px 8px rgba(138,148,166,1.00)',
        elevation: 3,
    },
})
