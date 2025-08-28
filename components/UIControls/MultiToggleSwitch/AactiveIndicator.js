import React, { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MyPlatform from '../../MyPlatform'
import { colors } from '../../styles/global'

export default function AactiveIndicator({ options, optionsRefs, currentIndex }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [optionsWidths, setOptionsWidths] = useState(new Array(options.length).fill(0))
    const width = useRef(new Animated.Value(0)).current
    const position = useRef(new Animated.Value(0)).current

    const getOffset = () => {
        let width = 0
        for (let i = 0; i < currentIndex; i++) {
            width += optionsWidths[i]
        }

        return width
    }

    const animate = widths => {
        let posValue = getOffset()

        Animated.parallel(
            [
                Animated.timing(position, {
                    toValue: posValue,
                    duration: 300,
                }),
                Animated.timing(width, {
                    toValue: widths[currentIndex],
                    duration: 200,
                }),
            ],
            { stopTogether: false }
        ).start()
    }

    const updateWidths = async () => {
        let functors = []

        for (let i = 0; i < optionsRefs.length; i++) {
            functors.push(MyPlatform.getElementWidth(optionsRefs[i]))
        }

        const widths = await Promise.all(functors)

        animate(widths)
        setOptionsWidths(widths)
    }

    useEffect(() => {
        updateWidths()
    }, [currentIndex])

    useEffect(() => {
        updateWidths()
    }, [JSON.stringify(optionsWidths)])

    useEffect(() => {
        updateWidths()
    }, [smallScreenNavigation])

    useEffect(() => {
        setOptionsWidths(new Array(options.length).fill(0))
    }, [JSON.stringify(options)])

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
        shadowColor: colors.Text03,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
    },
})
