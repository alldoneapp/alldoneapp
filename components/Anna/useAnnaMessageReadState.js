import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSelector } from 'react-redux'
import { markChatCommentsAsRead } from '../../utils/backends/Chats/markChatCommentsAsRead'
import { subscribePageVisible } from '../../utils/appResume'

export const getAnnaUnreadCommentIds = notification => [
    ...new Set([...(notification?.followedCommentIds || []), ...(notification?.unfollowedCommentIds || [])]),
]

const isPageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/**
 * A reply can reach the chat listener before its notification write reaches the project's unread
 * listener. Keep viewport state independently and reconcile in both directions so either arrival
 * order is safe. Fail closed when IntersectionObserver is unavailable: an unread message is more
 * honest than claiming that content the user may never have seen was read.
 */
export default function useAnnaMessageReadState(projectId, chatId, scrollRef, messages) {
    const notification = useSelector(state => state.projectChatNotifications?.[projectId]?.[chatId])
    const unreadIds = useMemo(() => getAnnaUnreadCommentIds(notification), [notification])
    const unreadIdsRef = useRef(new Set())
    const visibleIdsRef = useRef(new Set())
    const pendingIdsRef = useRef(new Set())
    const acknowledgedIdsRef = useRef(new Set())

    unreadIdsRef.current = new Set(unreadIds)

    const acknowledgeVisibleMessages = useCallback(() => {
        if (!projectId || !chatId || !isPageVisible()) return

        const commentIds = [...visibleIdsRef.current].filter(
            commentId =>
                unreadIdsRef.current.has(commentId) &&
                !pendingIdsRef.current.has(commentId) &&
                !acknowledgedIdsRef.current.has(commentId)
        )
        if (commentIds.length === 0) return

        commentIds.forEach(commentId => pendingIdsRef.current.add(commentId))
        markChatCommentsAsRead(commentIds.map(commentId => ({ projectId, chatId, commentId })))
            .then(() => commentIds.forEach(commentId => acknowledgedIdsRef.current.add(commentId)))
            .catch(error => {
                console.error('[anna read] Could not clear visible unread messages', {
                    projectId,
                    chatId,
                    commentIds,
                    code: error?.code,
                    message: error?.message,
                })
            })
            .finally(() => commentIds.forEach(commentId => pendingIdsRef.current.delete(commentId)))
    }, [projectId, chatId])

    useEffect(() => {
        visibleIdsRef.current.clear()
        pendingIdsRef.current.clear()
        acknowledgedIdsRef.current.clear()
    }, [projectId, chatId])

    useEffect(() => {
        acknowledgeVisibleMessages()
    }, [unreadIds, acknowledgeVisibleMessages])

    const firstMessageId = messages[0]?.id || ''
    const lastMessageId = messages[messages.length - 1]?.id || ''
    useEffect(() => {
        const root = scrollRef.current
        if (!root || typeof IntersectionObserver === 'undefined') return

        visibleIdsRef.current.clear()
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    const commentId = entry.target.dataset.annaMessageId
                    if (!commentId) return
                    if (entry.isIntersecting) visibleIdsRef.current.add(commentId)
                    else visibleIdsRef.current.delete(commentId)
                })
                acknowledgeVisibleMessages()
            },
            { root, threshold: 0 }
        )
        root.querySelectorAll('[data-anna-message-id]').forEach(element => observer.observe(element))

        return () => {
            observer.disconnect()
            visibleIdsRef.current.clear()
        }
    }, [scrollRef, messages.length, firstMessageId, lastMessageId, acknowledgeVisibleMessages])

    useEffect(() => {
        return subscribePageVisible(acknowledgeVisibleMessages)
    }, [acknowledgeVisibleMessages])
}
