import React, { useEffect, useState } from 'react'
import { Animated } from 'react-native'

import { colors } from '../../../styles/global'
import { STREAK_TICK_DELAY_MS } from './emptyInboxDotMotion'

/**
 * AT-2418 — the "Current streak" number, while today's dot is being added.
 *
 * The dot landing says "you did it today". This says what that WAS WORTH, and it is the reason the
 * celebration is a beat rather than a flash: the number holds at yesterday's streak while the dot
 * pops, then flips up and pops itself. Showing the new number from the start would make the dot a
 * decoration on a value that had already changed.
 *
 * The pre-tick value is `value - 1` by construction, not by remembering a previous render: the run
 * only ever starts because today became an achieved day, and today contributes exactly 1 to
 * `currentStreak` (`getEmptyInboxAchievementStats` walks back day by day from today). So the streak
 * without today is always one less — which also means this is correct on the replay path, where the
 * component mounts with the new value already in place and has no previous render to compare to.
 *
 * The scale lives on an `Animated.View`, NOT on the `Animated.Text` inside it, and that is not a
 * style preference. react-native-web renders `Text` as `display: inline`, and CSS transforms do not
 * apply to inline elements — a `transform: [{ scale }]` on the Text is silently dropped, no error,
 * no warning, and the number simply never moves. The colour flash does go on the Text, since colour
 * is not a transform.
 */
export default function EmptyInboxStreakValue({ value, celebration, style }) {
    const { tick, animated, celebrating } = celebration
    const ticking = animated && celebrating
    const [holdsPreviousValue, setHoldsPreviousValue] = useState(false)

    useEffect(() => {
        if (!ticking) {
            setHoldsPreviousValue(false)
            return undefined
        }

        setHoldsPreviousValue(true)
        const flipTimer = setTimeout(() => setHoldsPreviousValue(false), STREAK_TICK_DELAY_MS)

        return () => clearTimeout(flipTimer)
    }, [ticking])

    const displayedValue = holdsPreviousValue ? Math.max(0, value - 1) : value

    if (!ticking) {
        return (
            <Animated.Text testID="empty-inbox-streak-value" style={style}>
                {displayedValue}
            </Animated.Text>
        )
    }

    return (
        <Animated.View
            testID="empty-inbox-streak-tick"
            style={{
                transform: [{ scale: tick.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 1.32, 1] }) }],
            }}
        >
            <Animated.Text
                testID="empty-inbox-streak-value"
                style={[
                    style,
                    {
                        // Green on the way up, back to the card's text colour as it settles, so the
                        // number is tied to the dot that caused it without permanently restyling a
                        // metric that is grey every other day of the year.
                        color: tick.interpolate({
                            inputRange: [0, 0.25, 1],
                            outputRange: [colors.Text01, colors.UtilityGreen200, colors.Text01],
                        }),
                    },
                ]}
            >
                {displayedValue}
            </Animated.Text>
        </Animated.View>
    )
}
