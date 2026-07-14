import React, { useEffect, useState } from 'react'
import v4 from 'uuid/v4'
import { useSelector } from 'react-redux'

import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { getUnreadCommentsCount } from './unreadCommentsHelper'

export default function LastUserOrAssistantCommentContainer({
    setAModalIsOpen,
    project,
    objectId,
    objectType,
    fromChatNotification,
    isFollowedNotification,
    compact = false,
}) {
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const chatNotifications = useSelector(state => state.projectChatNotifications[project.id]?.[objectId])
    const unreadComments = getUnreadCommentsCount(chatNotifications, isFollowedNotification)
    const [commentText, setCommentText] = useState(null)
    const [chat, setChat] = useState(null)

    const updateComment = comments => {
        const comment = comments[0]
        setCommentText(comment ? comment.commentText : null)
    }

    useEffect(() => {
        const watcherKey = v4()
        watchComments(project.id, objectType, objectId, watcherKey, 1, updateComment)
        return () => {
            unwatch(watcherKey)
        }
    }, [objectId, objectType, project.id])

    useEffect(() => {
        const watcherKey = v4()
        watchChat(project.id, objectId, watcherKey, setChat)
        return () => {
            unwatch(watcherKey)
        }
    }, [objectId, project.id])

    if (commentText === null || commentText === undefined || !chat) return null

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
        />
    )
}
