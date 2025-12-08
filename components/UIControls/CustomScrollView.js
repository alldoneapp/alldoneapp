import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, View } from 'react-native'

import { colors } from '../styles/global'

const CustomScrollView = (
    {
        children,
        showIndicator = true,
        indicatorStyle,
        onScroll,
        externalOnLayout,
        scrollOnLayout,
        containerStyle,
        nativeID,
        style,
        onContentSizeChange: externalOnContentSizeChange,
        ...props
    },
    ref
) => {
    const [wholeHeight, setWholeHeight] = useState(1)
    const [visibleHeight, setVisibleHeight] = useState(0)
    const containerRef = useRef()
    const scrollRef = useRef()
    let indicator = useRef(new Animated.Value(0)).current

    const indicatorSize = wholeHeight > visibleHeight ? (visibleHeight * visibleHeight) / wholeHeight : visibleHeight
    if (indicatorSize >= visibleHeight) {
        props.onScrollbarGone && props.onScrollbarGone()
    } else {
        props.onScrollbarPresent && props.onScrollbarPresent()
    }
    const difference = visibleHeight > indicatorSize ? visibleHeight - indicatorSize : 1

    const onLayout = ({ nativeEvent }) => {
        setVisibleHeight(nativeEvent.layout.height)
        if (externalOnLayout) {
            externalOnLayout(containerRef)
        }
        if (scrollOnLayout) {
            scrollOnLayout({ nativeEvent })
        }
    }

    const onContentSizeChange = (width, height) => {
        setWholeHeight(height)
        if (externalOnContentSizeChange) {
            externalOnContentSizeChange(width, height)
        }
    }

    useImperativeHandle(ref, () => ({
        scrollTo: params => {
            scrollRef.current.scrollTo(params)
        },
        getVisibleHigh: () => {
            return visibleHeight
        },
        getContainerRef: () => {
            return containerRef
        },
        scrollToEnd: params => {
            return scrollRef.current.scrollToEnd(params)
        },
    }))

    const { style: _ignoredStyle, ...scrollProps } = props

    return (
        <View style={[{ flex: 1 }, containerStyle, style]} ref={containerRef} nativeID={nativeID}>
            <ScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={onContentSizeChange}
                onLayout={onLayout}
                scrollEventThrottle={16}
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: indicator } } }], {
                    listener: event => {
                        if (onScroll) onScroll(event)
                    },
                })}
                {...scrollProps}
            >
                {children}
            </ScrollView>

            {indicatorSize < visibleHeight && (
                <Animated.View
                    style={[
                        styles.indicator,
                        {
                            height:
                                indicatorSize < 4 || indicatorSize - 8 < 4
                                    ? 4
                                    : indicatorSize < 8
                                    ? indicatorSize
                                    : indicatorSize - 8,
                            transform: [
                                {
                                    translateY: Animated.multiply(indicator, visibleHeight / wholeHeight).interpolate({
                                        inputRange: [0, difference],
                                        outputRange: [0, difference],
                                        extrapolate: 'clamp',
                                    }),
                                },
                            ],
                        },
                        indicatorStyle,
                    ]}
                />
            )}
        </View>
    )
}

export default forwardRef(CustomScrollView)

const styles = StyleSheet.create({
    indicator: {
        position: 'absolute',
        top: 4,
        right: 4,
        bottom: 4,
        width: 4,
        backgroundColor: colors.Text03,
        opacity: 0.32,
        borderRadius: 10,
    },
})
