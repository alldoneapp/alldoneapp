import React from 'react'
import { Animated, View } from 'react-native'

import { ghostBaseStyles, ghostShimmerStyles } from './ghostAnimation'

/**
 * AT-2382 — one shimmering placeholder rectangle.
 *
 * `pulse` and `reducedMotion` come from a single `useGhostPulse()` call in the owning
 * ghost list, so every block in a group breathes in step and the group costs one
 * animation. The sweep child is skipped entirely under reduced motion — leaving a bare
 * tinted rectangle, which is the whole point of that preference.
 */
export default function GhostBlock({ style, pulse, reducedMotion, soft = false, testID }) {
    return (
        <Animated.View
            testID={testID}
            style={[soft ? ghostBaseStyles.softBlock : ghostBaseStyles.block, style, pulse ? { opacity: pulse } : null]}
        >
            {!reducedMotion && <View pointerEvents="none" style={ghostShimmerStyles.sweep} />}
        </Animated.View>
    )
}
