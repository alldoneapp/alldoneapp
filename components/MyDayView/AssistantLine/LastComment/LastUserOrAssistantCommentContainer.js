import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './lastCommentLayout'
import useLastCommentPreview from './useLastCommentPreview'
export { DEFERRED_LAST_COMMENT_REFRESH_MS } from './useLastCommentPreview'
import { useSelector } from 'react-redux'

import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import { getAllUnreadCommentIds, getUnreadCommentsCount } from './unreadCommentsHelper'
import { LastCommentPreviewSkeleton } from '../AssistantLineSkeleton'
import { buildLastCommentKey, useLastCommentArrival } from './lastCommentArrival'
import { isLiveComment } from './liveComment'

const MAX_COMMENTS_TO_VERIFY_UNREAD = 100

export default function LastUserOrAssistantCommentContainer({
    setAModalIsOpen,
    project,
    objectId,
    objectType,
    fromChatNotification,
    isFollowedNotification,
    compact = false,
    scopeKey = null,
}) {
    const userId = useSelector(state => state.loggedUser.uid)
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const chatNotifications = useSelector(state => state.projectChatNotifications[project.id]?.[objectId])
    const allUnreadCommentIds = getAllUnreadCommentIds(chatNotifications)
    const commentsToWatch = Math.min(allUnreadCommentIds.length + 1, MAX_COMMENTS_TO_VERIFY_UNREAD)
    const { commentText, chat, comments, failed, retry } = useLastCommentPreview(
        { userId, projectId: project.id, objectType, objectId },
        commentsToWatch
    )
    const recentComments = comments || []
    const unreadComments = getUnreadCommentsCount(chatNotifications, isFollowedNotification, recentComments)

    // AT-2511 — the identity of what this slot is DISPLAYING, resolved here because this is the one
    // component that sees both sources the preview renders from (the localStorage cache and the
    // Firestore watcher) and can therefore give them the same key. See `lastCommentArrival.js` for
    // why the same key has to come out of both, and why the memory outlives this mount.
    //
    // The streaming signal is read here for the same reason: `commentText` is all the card below
    // ever receives, and a half-written answer is indistinguishable from a finished one by its text.
    // Only the raw watcher documents carry the run flags, and this is the last component that holds
    // them. The cached preview has no comment object at all, which is correct — it is a first paint,
    // never an arrival.
    const displayedComment = recentComments[0]
    const arrivalId = useLastCommentArrival({
        scopeKey,
        commentKey: buildLastCommentKey({ objectType, objectId, commentText }),
        commentId: displayedComment?.id ?? null,
        isStreaming: isLiveComment(displayedComment),
    })

    if (commentText === null || commentText === undefined || !chat) {
        return failed ? (
            <View
                testID="assistant-last-comment-unavailable"
                style={{ minHeight: LAST_COMMENT_PREVIEW_HEIGHT, justifyContent: 'center' }}
            >
                <Text style={{ color: colors.Text03 }}>{translate('The last comment could not be loaded.')}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={retry}>
                    <Text style={{ color: colors.Primary100, paddingVertical: 8 }}>{translate('Try again')}</Text>
                </TouchableOpacity>
            </View>
        ) : (
            <LastCommentPreviewSkeleton compact={compact} />
        )
    }

    const assistantId = fromChatNotification
        ? chat.assistantId || defaultAssistantId
        : chat.assistantId || project.assistantId || defaultAssistantId

    return (
        <LastAssistantCommentWrapper
            projectId={project.id}
            isNew={!!fromChatNotification}
            unreadComments={fromChatNotification ? unreadComments : 0}
            isFollowedNotification={isFollowedNotification}
            objectId={objectId}
            objectType={objectType}
            objectName={chat.title}
            assistantId={assistantId}
            commentText={commentText}
            setAModalIsOpen={setAModalIsOpen}
            compact={compact}
            arrivalId={arrivalId}
        />
    )
}
