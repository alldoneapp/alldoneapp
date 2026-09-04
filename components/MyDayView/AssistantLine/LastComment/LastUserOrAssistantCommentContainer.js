import React, { useEffect, useMemo, useState } from 'react'
import v4 from 'uuid/v4'
import { useSelector } from 'react-redux'

import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { getAllUnreadCommentIds, getUnreadCommentsCount } from './unreadCommentsHelper'
import { LastCommentPreviewSkeleton } from '../AssistantLineSkeleton'
import { readLastCommentCache, writeLastCommentCache } from '../assistantLineCache'
import { buildLastCommentKey, useLastCommentArrival } from './lastCommentArrival'

const MAX_COMMENTS_TO_VERIFY_UNREAD = 100
export const DEFERRED_LAST_COMMENT_REFRESH_MS = 1000

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
    const cachedPreview = useMemo(
        () =>
            readLastCommentCache({
                userId,
                projectId: project.id,
                objectType,
                objectId,
            }),
        [objectId, objectType, project.id, userId]
    )
    const [commentText, setCommentText] = useState(cachedPreview?.commentText ?? null)
    const [chat, setChat] = useState(cachedPreview?.chat ?? null)
    const [recentComments, setRecentComments] = useState([])
    const unreadComments = getUnreadCommentsCount(chatNotifications, isFollowedNotification, recentComments)

    const updateComment = comments => {
        const comment = comments[0]
        setCommentText(comment ? comment.commentText : null)
        setRecentComments(comments)
    }

    useEffect(() => {
        const watcherKey = v4()
        let watcherStarted = false
        const startWatcher = () => {
            watcherStarted = true
            watchComments(project.id, objectType, objectId, watcherKey, commentsToWatch, updateComment)
        }
        const refreshTimer = cachedPreview ? setTimeout(startWatcher, DEFERRED_LAST_COMMENT_REFRESH_MS) : null
        if (!cachedPreview) startWatcher()

        return () => {
            if (refreshTimer) clearTimeout(refreshTimer)
            if (watcherStarted) unwatch(watcherKey)
        }
    }, [cachedPreview, commentsToWatch, objectId, objectType, project.id])

    useEffect(() => {
        const watcherKey = v4()
        let watcherStarted = false
        const startWatcher = () => {
            watcherStarted = true
            watchChat(project.id, objectId, watcherKey, setChat)
        }
        const refreshTimer = cachedPreview ? setTimeout(startWatcher, DEFERRED_LAST_COMMENT_REFRESH_MS) : null
        if (!cachedPreview) startWatcher()

        return () => {
            if (refreshTimer) clearTimeout(refreshTimer)
            if (watcherStarted) unwatch(watcherKey)
        }
    }, [cachedPreview, objectId, project.id])

    useEffect(() => {
        if (typeof commentText !== 'string' || !chat) return

        writeLastCommentCache(
            {
                userId,
                projectId: project.id,
                objectType,
                objectId,
            },
            { commentText, chat }
        )
    }, [chat, commentText, objectId, objectType, project.id, userId])

    // AT-2511 — the identity of what this slot is DISPLAYING, resolved here because this is the one
    // component that sees both sources the preview renders from (the localStorage cache and the
    // Firestore watcher) and can therefore give them the same key. See `lastCommentArrival.js` for
    // why the same key has to come out of both, and why the memory outlives this mount.
    const arrivalId = useLastCommentArrival({
        scopeKey,
        commentKey: buildLastCommentKey({ objectType, objectId, commentText }),
    })

    if (commentText === null || commentText === undefined || !chat) {
        return <LastCommentPreviewSkeleton compact={compact} />
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
