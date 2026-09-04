import React from 'react'
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../styles/global'
import UnreadCommentsBadge from './UnreadCommentsBadge'
import LastCommentRow, { rowStyles } from './LastCommentRow'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './lastCommentLayout'
import { useLastCommentArrivalMotion } from './lastCommentArrivalMotion'

export {
    LAST_COMMENT_PREVIEW_HEIGHT,
    PREVIEW_BODY_HEIGHT,
    PREVIEW_LINE_HEIGHT,
    PREVIEW_TITLE_HEIGHT,
    PREVIEW_VERTICAL_PADDING,
} from './lastCommentLayout'

/**
 * The preview reserves a constant height so the assistant line (and everything below it) never
 * reflows when the last comment changes length: one clipped title line plus two clipped body lines.
 *
 * AT-2511 — `arrivalId` is a fresh number whenever this slot starts showing a comment it has not
 * shown before (see `lastCommentArrival.js`), and it drives the ticker roll: the previous comment
 * rolls up and out while the new one rolls in from below. It is deliberately not derived here — a
 * comment landing in another chat REMOUNTS this component, so anything this component could compare
 * against itself is born empty exactly when it matters.
 *
 * The structure exists to serve the roll, and each level earns its place:
 *
 *   TouchableOpacity   the card — fixed height, background, radius. NO padding: the rows carry it.
 *     View             the viewport — fills the card's whole box and CLIPS, so the roll disappears
 *                      at the card's edges rather than over its neighbours.
 *       Animated.View  the outgoing comment (absolute, `pointerEvents: none`), only while rolling.
 *       Animated.View  the incoming comment (in flow, `flex: 1`).
 *     UnreadCommentsBadge   OUTSIDE the viewport, so `top/right: -5` is still unclipped.
 *
 * At rest the outgoing layer is not mounted at all and the incoming layer sits at `translateY: 0`,
 * so a card that is not receiving a comment renders exactly what it always did.
 */
export default function LastAssistantComment({
    projectId,
    commentText,
    onPress,
    objectName,
    isNew,
    unreadComments,
    isFollowedNotification,
    compact = false,
    arrivalId = null,
}) {
    const motion = useLastCommentArrivalMotion(arrivalId, { projectId, commentText, objectName }, compact)

    const rowStyle = compact ? rowStyles.compactRow : rowStyles.row

    return (
        <TouchableOpacity
            onPress={onPress}
            style={compact ? localStyles.compactContainer : localStyles.container}
            onLayout={motion.onCardLayout}
            testID="last-comment-card"
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
                        <LastCommentRow {...motion.outgoingRow} compact={compact} />
                    </Animated.View>
                )}
                <Animated.View
                    style={[rowStyle, localStyles.incomingRow, motion.incomingStyle]}
                    testID="last-comment-incoming-row"
                >
                    <LastCommentRow
                        projectId={projectId}
                        commentText={commentText}
                        objectName={objectName}
                        compact={compact}
                    />
                </Animated.View>
            </View>
            {isNew && (
                <UnreadCommentsBadge
                    amount={unreadComments}
                    followed={isFollowedNotification}
                    style={motion.badgeStyle}
                />
            )}
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
