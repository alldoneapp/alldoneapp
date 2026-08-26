import React, { useMemo } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../styles/global'

/**
 * AT-2445 — the visible half of the empty-inbox celebration.
 *
 * Pieces are thrown up and outward from behind the congratulation, tumble, and fall away while
 * fading. It is an overlay (`pointerEvents="none"`, absolutely positioned, zero layout impact), so
 * it can never push the congrats block around or intercept a tap on the Add task button underneath
 * it — the thing the retired full-screen Giphy overlay got wrong.
 */

export const CONFETTI_PIECE_COUNT = 14

// Brand accents. Green leads because it is the colour the rest of the completion vocabulary uses
// (the checkbox burst, the task progress bar, the achievement dot), and the others are there to
// stop fourteen identical green rectangles reading as a loading state.
const PIECE_COLORS = [
    colors.UtilityGreen200,
    colors.UtilityBlue200,
    colors.UtilityYellow200,
    colors.UtilityGreen150,
    colors.Primary100,
    colors.UtilityOrange200,
]

/**
 * Deterministic per index — NOT `Math.random()`.
 *
 * A random value read during render is re-rolled on every re-render, so a piece would teleport onto
 * a new trajectory each time the board re-rendered mid-flight (and the board re-renders constantly:
 * it is subscribed to the task counts). Hashing the index gives the same scatter every run while
 * keeping the burst irregular, which is the only property that matters here.
 */
const pseudoRandom = (index, salt) => {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
    return value - Math.floor(value)
}

const buildPieces = count =>
    Array.from({ length: count }, (_unused, index) => {
        const spread = pseudoRandom(index, 1)
        const lift = pseudoRandom(index, 2)
        const drift = pseudoRandom(index, 3)
        const spin = pseudoRandom(index, 4)
        // Fan out symmetrically around the headline's centre rather than in one direction.
        const direction = index % 2 === 0 ? 1 : -1

        return {
            key: `piece-${index}`,
            color: PIECE_COLORS[index % PIECE_COLORS.length],
            // How far out to the side the piece ends up, in px from centre.
            travelX: direction * (28 + spread * 150),
            // How high it is thrown before gravity takes over.
            peakY: -(46 + lift * 54),
            // Where it has fallen to by the end of the run.
            fallY: 70 + drift * 90,
            rotations: (spin > 0.5 ? 1 : -1) * (1.2 + spin * 2.4),
            width: 5 + Math.round(spread * 4),
            height: 9 + Math.round(lift * 5),
            // Staggered launch, so the burst reads as a scatter rather than a single wall.
            delay: 0.04 * (index % 5),
        }
    })

/**
 * @param {object} props
 * @param {Animated.Value} props.confetti 0 → 1 across the run, shared with the rest of the
 *   celebration so every beat belongs to one event.
 * @param {boolean} props.visible False under reduced motion, under jest, and whenever there is
 *   nothing to celebrate — in all three cases nothing is rendered at all, because confetti carries
 *   no information a static frame could preserve.
 */
export default function EmptyInboxConfetti({ confetti, visible }) {
    const pieces = useMemo(() => buildPieces(CONFETTI_PIECE_COUNT), [])

    if (!visible) return null

    return (
        <View testID="empty-inbox-confetti" style={localStyles.container}>
            {pieces.map(piece => {
                // Each piece runs its own window of the shared value, so they can stagger without
                // ever drifting apart.
                const start = piece.delay
                const clamp = { extrapolate: 'clamp' }

                return (
                    <Animated.View
                        key={piece.key}
                        testID="empty-inbox-confetti-piece"
                        style={[
                            localStyles.piece,
                            {
                                width: piece.width,
                                height: piece.height,
                                backgroundColor: piece.color,
                                opacity: confetti.interpolate({
                                    inputRange: [start, start + 0.06, 0.62, 0.96],
                                    outputRange: [0, 1, 1, 0],
                                    ...clamp,
                                }),
                                transform: [
                                    {
                                        translateX: confetti.interpolate({
                                            inputRange: [start, 1],
                                            outputRange: [0, piece.travelX],
                                            ...clamp,
                                        }),
                                    },
                                    {
                                        // Up first, then down: the two-segment range is what makes
                                        // it read as thrown rather than as sliding outward.
                                        translateY: confetti.interpolate({
                                            inputRange: [start, start + 0.28, 1],
                                            outputRange: [0, piece.peakY, piece.fallY],
                                            ...clamp,
                                        }),
                                    },
                                    {
                                        rotate: confetti.interpolate({
                                            inputRange: [start, 1],
                                            outputRange: ['0deg', `${piece.rotations * 360}deg`],
                                            ...clamp,
                                        }),
                                    },
                                ],
                            },
                        ]}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // Anchored to the centre of the congrats block's first line, with zero size, so every piece
    // starts from the same point and the overlay contributes no layout of its own.
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 1,
        // In style, not as a prop: react-native-web 0.21 deprecates `props.pointerEvents`.
        pointerEvents: 'none',
    },
    piece: {
        position: 'absolute',
        borderRadius: 1,
    },
})
