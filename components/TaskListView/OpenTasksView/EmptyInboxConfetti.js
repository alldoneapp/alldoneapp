import React, { useMemo } from 'react'
import { Animated, Dimensions, Platform, StyleSheet, View } from 'react-native'

import { colors } from '../../styles/global'

/**
 * AT-2445 / AT-2460 — the visible half of the empty-inbox celebration.
 *
 * TWO layers, and they are two because they say different things:
 *
 *   • the BURST is anchored to the congrats block and thrown from behind the headline, so the
 *     celebration is visibly caused by the line the user is reading;
 *   • the PAGE FALL (AT-2460) covers the whole viewport, so the moment is unmissable from across a
 *     room and on a desktop board where the congrats block is a small island in a wide column.
 *
 * Both share ONE `Animated.Value`, so they can never drift into two overlapping animations.
 *
 * The page layer is `position: fixed` rather than a portal into `document.body`, for two reasons.
 * It keeps the whole celebration inside one React tree, so it mounts and unmounts with the block
 * that owns it and cannot be orphaned; and `react-dom`'s `createPortal` cannot be rendered by
 * `react-test-renderer`, which is what every suite around this feature uses. Fixed positioning
 * degrades safely: if some future ancestor grows a `transform` (which makes it the containing block
 * for fixed descendants) the fall is confined to that ancestor instead of the viewport — smaller,
 * never broken.
 *
 * What keeps this on the right side of the full-screen Giphy overlay that AT-2404 retired: it is
 * `pointerEvents: none` end to end so it can never intercept a tap, it paints nothing opaque over
 * content, it costs no network round trip, it fires at most once a day, and it disappears on a
 * timer that does not depend on any animation callback arriving.
 */

// Thrown from behind the headline.
export const CONFETTI_BURST_PIECE_COUNT = 16
// Falling across the whole viewport.
export const CONFETTI_PAGE_PIECE_COUNT = 30
export const CONFETTI_PIECE_COUNT = CONFETTI_BURST_PIECE_COUNT + CONFETTI_PAGE_PIECE_COUNT

// Sits above page content but well under the modal/popover portals that append themselves to
// `document.body` — a celebration must never paint over a dialog the user opened.
const PAGE_LAYER_Z_INDEX = 30

// Brand accents. Green leads because it is the colour the rest of the completion vocabulary uses
// (the checkbox burst, the task progress bar, the achievement dot), and the others are there to
// stop identical green rectangles reading as a loading state.
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

const buildBurstPieces = count =>
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
            travelX: direction * (36 + spread * 230),
            // How high it is thrown before gravity takes over.
            peakY: -(70 + lift * 90),
            // Where it has fallen to by the end of the run.
            fallY: 150 + drift * 220,
            rotations: (spin > 0.5 ? 1 : -1) * (1.6 + spin * 3),
            width: 6 + Math.round(spread * 5),
            height: 10 + Math.round(lift * 6),
            // Staggered launch, so the burst reads as a scatter rather than a single wall.
            delay: 0.03 * (index % 5),
        }
    })

/**
 * The page fall. Pieces start above the top edge of the viewport and are gone below the bottom of
 * it by the end of the run.
 *
 * The horizontal placement is one even column per piece plus a bounded jitter, rather than a free
 * random x. Free randomness at this count reliably leaves a visible bald patch somewhere across a
 * wide screen and clumps three pieces together somewhere else; columns guarantee coverage and the
 * jitter is what stops it looking like a ruler.
 */
const buildPagePieces = (count, viewportWidth, viewportHeight) => {
    const columnWidth = viewportWidth / count

    return Array.from({ length: count }, (_unused, index) => {
        const jitter = pseudoRandom(index, 5)
        const speed = pseudoRandom(index, 6)
        const sway = pseudoRandom(index, 7)
        const spin = pseudoRandom(index, 8)
        const size = pseudoRandom(index, 9)
        // Pieces do not all start at the same height above the fold, so the leading edge of the
        // fall is ragged instead of a curtain dropping in one line.
        const startY = -30 - Math.round(jitter * 140)
        // Staggered starts and varied end points give a range of fall speeds inside one shared
        // value: a piece that finishes at 0.6 crosses the screen noticeably faster than one that
        // finishes at 1.
        const start = 0.02 * (index % 9)
        const end = Math.min(1, 0.6 + speed * 0.4)

        return {
            key: `page-piece-${index}`,
            color: PIECE_COLORS[(index + 2) % PIECE_COLORS.length],
            left: Math.round(index * columnWidth + jitter * columnWidth),
            startY,
            // Past the bottom edge, so nothing is ever left resting on the last frame.
            fallY: viewportHeight - startY + 80,
            swayX: (index % 2 === 0 ? 1 : -1) * (16 + sway * 54),
            rotations: (spin > 0.5 ? 1 : -1) * (1.4 + spin * 3.4),
            width: 6 + Math.round(size * 5),
            height: 10 + Math.round(speed * 7),
            start,
            end,
        }
    })
}

const CLAMP = { extrapolate: 'clamp' }

/**
 * One piece of the page fall: down, swaying, tumbling, fading out before it lands.
 */
const PagePiece = ({ confetti, piece }) => (
    <Animated.View
        testID="empty-inbox-confetti-piece"
        style={[
            localStyles.piece,
            {
                left: piece.left,
                top: piece.startY,
                width: piece.width,
                height: piece.height,
                backgroundColor: piece.color,
                opacity: confetti.interpolate({
                    inputRange: [piece.start, piece.start + 0.05, piece.end - 0.12, piece.end],
                    outputRange: [0, 1, 1, 0],
                    ...CLAMP,
                }),
                transform: [
                    {
                        // Sway out and drift back, so the fall reads as paper rather than as
                        // objects on rails.
                        translateX: confetti.interpolate({
                            inputRange: [piece.start, (piece.start + piece.end) / 2, piece.end],
                            outputRange: [0, piece.swayX, piece.swayX * 0.25],
                            ...CLAMP,
                        }),
                    },
                    {
                        translateY: confetti.interpolate({
                            inputRange: [piece.start, piece.end],
                            outputRange: [0, piece.fallY],
                            ...CLAMP,
                        }),
                    },
                    {
                        rotate: confetti.interpolate({
                            inputRange: [piece.start, piece.end],
                            outputRange: ['0deg', `${piece.rotations * 360}deg`],
                            ...CLAMP,
                        }),
                    },
                ],
            },
        ]}
    />
)

/**
 * One piece of the burst: thrown up and out, then falling away.
 */
const BurstPiece = ({ confetti, piece }) => {
    const start = piece.delay
    // The burst is the opening beat, so it is over well before the page fall finishes; without this
    // the thrown pieces would hang in the air above the headline for two more seconds.
    const end = 0.55

    return (
        <Animated.View
            testID="empty-inbox-confetti-piece"
            style={[
                localStyles.piece,
                {
                    width: piece.width,
                    height: piece.height,
                    backgroundColor: piece.color,
                    opacity: confetti.interpolate({
                        inputRange: [start, start + 0.04, end - 0.16, end],
                        outputRange: [0, 1, 1, 0],
                        ...CLAMP,
                    }),
                    transform: [
                        {
                            translateX: confetti.interpolate({
                                inputRange: [start, end],
                                outputRange: [0, piece.travelX],
                                ...CLAMP,
                            }),
                        },
                        {
                            // Up first, then down: the two-segment range is what makes it read as
                            // thrown rather than as sliding outward.
                            translateY: confetti.interpolate({
                                inputRange: [start, start + 0.14, end],
                                outputRange: [0, piece.peakY, piece.fallY],
                                ...CLAMP,
                            }),
                        },
                        {
                            rotate: confetti.interpolate({
                                inputRange: [start, end],
                                outputRange: ['0deg', `${piece.rotations * 360}deg`],
                                ...CLAMP,
                            }),
                        },
                    ],
                },
            ]}
        />
    )
}

/**
 * @param {object} props
 * @param {Animated.Value} props.confetti 0 → 1 across the run, shared with the rest of the
 *   celebration so every beat belongs to one event.
 * @param {boolean} props.visible False under reduced motion, under jest, and whenever there is
 *   nothing to celebrate — in all three cases nothing is rendered at all, because confetti carries
 *   no information a static frame could preserve.
 */
export default function EmptyInboxConfetti({ confetti, visible }) {
    // `Dimensions.get('window')`, not `useWindowDimensions()` — the latter is not reliably provided
    // by this RN/web setup and throws at runtime (see CLAUDE.md). Read once per size: the fall lasts
    // ~3s, so a resize mid-flight is not worth re-deriving trajectories for, and re-deriving them
    // would move every piece the moment the window moved.
    const { width, height } = Dimensions.get('window')
    const burstPieces = useMemo(() => buildBurstPieces(CONFETTI_BURST_PIECE_COUNT), [])
    const pagePieces = useMemo(() => buildPagePieces(CONFETTI_PAGE_PIECE_COUNT, width, height), [width, height])

    if (!visible) return null

    return (
        <>
            <View testID="empty-inbox-confetti" style={localStyles.pageLayer}>
                {pagePieces.map(piece => (
                    <PagePiece key={piece.key} confetti={confetti} piece={piece} />
                ))}
            </View>
            <View testID="empty-inbox-confetti-burst" style={localStyles.burstLayer}>
                {burstPieces.map(piece => (
                    <BurstPiece key={piece.key} confetti={confetti} piece={piece} />
                ))}
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    // The whole viewport. `overflow: hidden` so a piece still travelling past the bottom edge can
    // never add a scrollbar to a shell whose scrolling contract is as delicate as this one's
    // (see the app-shell scrolling notes in CLAUDE.md).
    pageLayer: {
        position: 'absolute',
        ...Platform.select({ web: { position: 'fixed' } }),
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        zIndex: PAGE_LAYER_Z_INDEX,
        // In style, not as a prop: react-native-web 0.21 deprecates `props.pointerEvents`.
        pointerEvents: 'none',
    },
    // Anchored to the centre of the congrats block's first line, with zero size, so every piece
    // starts from the same point and the overlay contributes no layout of its own.
    burstLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 1,
        pointerEvents: 'none',
    },
    piece: {
        position: 'absolute',
        borderRadius: 1,
    },
})
