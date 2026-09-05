import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'
import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

export const MILESTONE_EXIT_MS = 720

// Keep the departing presentation alive after its milestone leaves the open list.
// The parent keys this boundary by project and user so navigation never plays an exit.
export default function MilestoneRowTransition({ milestoneId, children }) {
    const reducedMotion = useReducedMotion()
    const [displayedId, setDisplayedId] = useState(milestoneId)
    const previousChildren = useRef(children)
    const measuredHeight = useRef(0)
    const progress = useRef(new Animated.Value(0)).current
    const exiting = !reducedMotion && displayedId != null && displayedId !== milestoneId
    const exitingRef = useRef(exiting)
    exitingRef.current = exiting

    const onLayout = useCallback(event => {
        if (!exitingRef.current) measuredHeight.current = event.nativeEvent.layout.height
    }, [])

    useLayoutEffect(() => {
        if (!exiting) {
            previousChildren.current = children
            if (displayedId !== milestoneId) setDisplayedId(milestoneId)
        }
    }, [children, displayedId, milestoneId, exiting])

    useLayoutEffect(() => {
        progress.setValue(0)
        if (!exiting) return undefined
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: MILESTONE_EXIT_MS,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
        })
        animation.start()
        // Release even when an interrupted animation never delivers its callback.
        const timer = setTimeout(() => setDisplayedId(milestoneId), MILESTONE_EXIT_MS)
        return () => {
            clearTimeout(timer)
            animation.stop()
        }
    }, [exiting, milestoneId, progress])

    if (!exiting && milestoneId == null) return null

    return (
        <Animated.View
            testID="milestone-row-transition"
            onLayout={onLayout}
            style={
                exiting && {
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    opacity: progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0, 0] }),
                    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
                    ...(measuredHeight.current > 0 && {
                        height: progress.interpolate({
                            inputRange: [0, 0.25, 1],
                            outputRange: [measuredHeight.current, measuredHeight.current, 0],
                        }),
                    }),
                }
            }
        >
            {exiting ? previousChildren.current : children}
        </Animated.View>
    )
}
