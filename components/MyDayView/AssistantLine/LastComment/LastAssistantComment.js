import React from 'react'

import UnreadCommentsBadge from './UnreadCommentsBadge'
import LastCommentRow from './LastCommentRow'
import LastCommentRollCard from './LastCommentRollCard'
import { LAST_COMMENT_ROW_PREVIEW } from './lastCommentSlotRow'

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
 * AT-2523 — the card itself is now `LastCommentRollCard`, shared with the pending-send card so the
 * two cannot drift, and `scopeKey` is threaded down so the roll can name the row this slot really
 * had on screen even across a remount. This component is what goes INSIDE it.
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
    scopeKey = null,
}) {
    return (
        <LastCommentRollCard
            projectId={projectId}
            commentText={commentText}
            objectName={objectName}
            scopeKey={scopeKey}
            rowKind={LAST_COMMENT_ROW_PREVIEW}
            arrivalId={arrivalId}
            compact={compact}
            onPress={onPress}
            testID="last-comment-card"
            renderBadge={
                isNew
                    ? badgeStyle => (
                          <UnreadCommentsBadge
                              amount={unreadComments}
                              followed={isFollowedNotification}
                              style={badgeStyle}
                          />
                      )
                    : null
            }
        >
            <LastCommentRow projectId={projectId} commentText={commentText} objectName={objectName} compact={compact} />
        </LastCommentRollCard>
    )
}
