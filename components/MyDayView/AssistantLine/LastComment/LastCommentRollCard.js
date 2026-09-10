import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../styles/global'
import { LAST_COMMENT_PREVIEW_HEIGHT, rowStyles } from './lastCommentLayout'
import { useLastCommentArrivalMotion } from './lastCommentArrivalMotion'
import { getLastCommentSlotRow, recordLastCommentSlotRow } from './lastCommentSlotRow'

/**
 * Required at the point of use, not imported at the top.
 *
 * `LastCommentRow` is the whole comment/tag/navigation graph — hashtags, mentions, links,
 * `TasksHelper`, and through them the redux store — and it is needed ONLY to draw the row that is
 * rolling away, which exists for 420ms and only when an arrival is actually animating. A static
 * import would drag that graph into the pending-send card, which draws its own content and has
 * never needed any of it. The module is in the same bundle either way, so this costs nothing at
 * runtime; what it buys is that a card which never rolls never touches it.
 */
const getLastCommentRow = () => require('./LastCommentRow').default

/**
 * AT-2523 — the Last comment card, as a shell that anything can be rendered inside.
 *
 * It was `LastAssistantComment`'s own body until the AT-2504 pending card needed the same ticker
 * roll, the same fixed geometry and the same press target. Copying it would have been the obvious
 * move and is exactly the mistake AT-2511 already paid for once: the card and its popover branch
 * were two hand-written copies of the same element, `arrivalId` was added to one of them, and the
 * animation was inert in production for every user while both suites stayed green. So there is one
 * card, and the thing that differs — what is IN the row — is a child.
 *
 * The structure, unchanged from AT-2511, each level earning its place:
 *
 *   TouchableOpacity   the card — fixed height, background, radius. NO padding: the rows carry it.
 *     View             the viewport — fills the card's whole box and CLIPS, so the roll disappears
 *                      at the card's edges rather than over its neighbours.
 *       Animated.View  the outgoing comment (absolute, `pointerEvents: none`), only while rolling.
 *       Animated.View  the incoming content (in flow, `flex: 1`) — `children`.
 *     badge            OUTSIDE the viewport, so `top/right: -5` is still unclipped.
 *
 * At rest the outgoing layer is not mounted at all and the incoming layer sits at `translateY: 0`,
 * so a card that is not receiving a comment renders exactly what it always did.
 *
 * ## The slot memory
 *
 * The card reads the row this slot last displayed (`lastCommentSlotRow.js`) ONCE, at mount, and
 * hands it to the motion hook as the seed for "what is rolling away"; it records its own row on the
 * way past. Both halves live here rather than in the two callers because the pairing is the whole
 * contract — a card that read the memory without writing it would break the next card's departure,
 * and the failure would be a missing flourish that no test naturally looks for.
 *
 * The read is a plain render-phase lookup of module state (pure, and stable across the double
 * invocation React does in development, since `useRef`'s initializer result is what is kept). The
 * write is an effect, because it must not happen for a render that is thrown away.
 */
export default function LastCommentRollCard({
    projectId,
    commentText,
    objectName,
    scopeKey = null,
    rowKind,
    arrivalId = null,
    compact = false,
    onPress,
    disabled = false,
    accessibilityLabel,
    accessibilityLiveRegion,
    testID = 'last-comment-card',
    renderBadge = null,
    children,
}) {
    const row = { projectId, commentText, objectName }

    // Read before this card records anything, so it names the row the PREVIOUS occupant of this
    // slot left behind rather than this card's own. `rowKind` is what keeps a preview from
    // consuming another preview's row — see `lastCommentSlotRow.js`.
    const seedRow = useRef(getLastCommentSlotRow(scopeKey, rowKind)).current
    const motion = useLastCommentArrivalMotion(arrivalId, row, compact, seedRow)

    useEffect(() => {
        recordLastCommentSlotRow(scopeKey, rowKind, { projectId, commentText, objectName })
    }, [scopeKey, rowKind, projectId, commentText, objectName])

    const rowStyle = compact ? rowStyles.compactRow : rowStyles.row

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled || !onPress}
            accessibilityLabel={accessibilityLabel}
            accessibilityLiveRegion={accessibilityLiveRegion}
            style={compact ? localStyles.compactContainer : localStyles.container}
            onLayout={motion.onCardLayout}
            testID={testID}
        >
            <View
                style={compact ? localStyles.compactViewport : localStyles.viewport}
                testID="last-comment-roll-viewport"
            >
                {!!motion.outgoingRow && (
                    <Animated.View
                        style={[rowStyle, localStyles.outgoingRow, motion.outgoingStyle]}
                        pointerEvents="none"
                        testID="last-comment-outgoing-row"
                    >
                        {React.createElement(getLastCommentRow(), { ...motion.outgoingRow, compact })}
                    </Animated.View>
                )}
                <Animated.View
                    style={[rowStyle, localStyles.incomingRow, motion.incomingStyle]}
                    testID="last-comment-incoming-row"
                >
                    {children}
                </Animated.View>
            </View>
            {/*
             * A render prop, not an element: the badge is the one thing OUTSIDE the clip and the
             * one thing allowed to overshoot, so it needs the motion's own `badgeStyle` — which
             * only exists in here. Passing a finished element would silently drop the pop.
             */}
            {renderBadge ? renderBadge(motion.badgeStyle) : null}
        </TouchableOpacity>
    )
}

const CARD_RADIUS = 12

const localStyles = StyleSheet.create({
    container: {
        // Fixed (not min/max) so a short comment reserves exactly as much room as a long one.
        height: LAST_COMMENT_PREVIEW_HEIGHT,
        flexShrink: 0,
        // No overflow: 'hidden' here — the unread badge sits at top/right: -5, outside the card.
        // The viewport inside does the clipping instead.
        backgroundColor: colors.Grey300,
        borderRadius: CARD_RADIUS,
        flexDirection: 'row',
    },
    compactContainer: {
        height: 24,
        maxHeight: 24,
        borderRadius: CARD_RADIUS,
        flexDirection: 'row',
        backgroundColor: colors.Grey300,
        width: 'auto',
        maxWidth: '100%',
    },
    /**
     * Fills the CARD's box, not its content box — the card's padding was moved onto the rows for
     * exactly this reason. A viewport inset by the padding would shift `ProjectTagIndicator`
     * (absolute at `right: 10 / top: 10`) by that padding, moving a tag that has never moved.
     */
    viewport: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: CARD_RADIUS,
        overflow: 'hidden',
    },
    compactViewport: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: CARD_RADIUS,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    incomingRow: {
        flex: 1,
    },
    outgoingRow: {
        ...StyleSheet.absoluteFillObject,
    },
})
