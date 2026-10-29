import { useEffect, useRef, useState } from 'react'
import v4 from 'uuid/v4'
import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { unwatch } from '../../../../utils/backends/firestore'
import {
    readDocumentDirectlyFromServer,
    readLatestCommentDirectlyFromServer,
} from '../../../../utils/backends/firestoreDirectRead'
import { isBrowserOffline } from '../../../../utils/connectionState'
import { isManualOfflineMode } from '../../../../utils/connectionHealth'
import { readLastCommentCache, writeLastCommentCache, removeLastCommentCache } from '../assistantLineCache'

export const DEFERRED_LAST_COMMENT_REFRESH_MS = 1000
export const LAST_COMMENT_LOAD_TIMEOUT_MS = 6000

const isDenied = error =>
    ['permission-denied', 'unauthenticated', 'http-403', 'http-401'].includes(
        String(error?.code || '')
            .toLowerCase()
            .replace(/_/g, '-')
    )

export default function useLastCommentPreview(context, commentsToWatch) {
    const { userId, projectId, objectType, objectId } = context
    const scope = `${userId}:${projectId}:${objectType}:${objectId}`
    const [attempt, setAttempt] = useState(0)
    const [preview, setPreview] = useState(() => {
        const cached = readLastCommentCache(context)
        return { scope, chat: cached?.chat, comments: null, commentText: cached?.commentText, failed: false }
    })
    const current = useRef(preview)

    useEffect(() => {
        let active = true
        let denied = false
        let chatAuthoritative = false
        let commentsAuthoritative = false
        let timer, refreshTimer
        const controller = new AbortController()
        const chatKey = v4(),
            commentsKey = v4()
        let watchersStarted = false
        if (current.current.scope !== scope) {
            const cached = readLastCommentCache(context)
            current.current = {
                scope,
                chat: cached?.chat,
                commentText: cached?.commentText,
                comments: null,
                failed: false,
            }
        }
        current.current = { ...current.current, failed: false }
        setPreview(current.current)
        const ready = () => !!current.current.chat && typeof current.current.commentText === 'string'
        const publish = patch => {
            if (!active || denied) return
            current.current = { ...current.current, ...patch }
            if (ready()) {
                current.current.failed = false
                writeLastCommentCache(context, current.current)
            }
            setPreview(current.current)
        }
        const fail = error => {
            if (!active) return
            if (isDenied(error)) {
                removeLastCommentCache(context)
                publish({ chat: null, comments: null, commentText: null, failed: true })
                denied = true
                controller.abort()
            } else {
                publish({ failed: true })
            }
        }
        const receiveChat = (chat, metadata = {}, direct = false) => {
            if (!active || denied || ((metadata.fromCache || direct) && chatAuthoritative)) return
            if (metadata.fromCache && (!chat || ready())) return
            if (!metadata.fromCache) chatAuthoritative = true
            if (!chat) removeLastCommentCache(context)
            publish({ chat, ...(!chat ? { failed: true } : {}) })
        }
        const receiveComments = (comments, metadata = {}, direct = false) => {
            if (!active || denied || ((metadata.fromCache || direct) && commentsAuthoritative)) return
            if (metadata.fromCache && (!comments.length || ready())) return
            if (!metadata.fromCache) commentsAuthoritative = true
            const commentText = comments[0]?.commentText
            if (typeof commentText !== 'string') removeLastCommentCache(context)
            publish({ comments, commentText, ...(typeof commentText !== 'string' ? { failed: true } : {}) })
        }
        const start = () => {
            if (!active) return
            watchersStarted = true
            watchChat(projectId, objectId, chatKey, receiveChat, { onError: fail })
            watchComments(projectId, objectType, objectId, commentsKey, commentsToWatch, receiveComments, {
                onError: fail,
            })
            if (!ready()) {
                // The deadline includes Auth token lookup as well as both reads. Listeners
                // remain attached so a late live answer can recover the retry placeholder.
                timer = setTimeout(() => {
                    controller.abort()
                    fail(new Error('Comment preview loading timed out'))
                }, LAST_COMMENT_LOAD_TIMEOUT_MS)
                if (isBrowserOffline() || isManualOfflineMode()) {
                    fail(new Error('Comment preview is not available offline'))
                    return
                }
                readDocumentDirectlyFromServer(`chatObjects/${projectId}/chats/${objectId}`, {
                    signal: controller.signal,
                })
                    .then(result => {
                        if (!controller.signal.aborted) receiveChat(result.exists ? result.data : null, {}, true)
                    })
                    .catch(fail)
                readLatestCommentDirectlyFromServer(`chatComments/${projectId}/${objectType}/${objectId}`, {
                    signal: controller.signal,
                })
                    .then(comments => {
                        if (!controller.signal.aborted) receiveComments(comments, {}, true)
                    })
                    .catch(fail)
            }
        }
        if (ready()) refreshTimer = setTimeout(start, DEFERRED_LAST_COMMENT_REFRESH_MS)
        else start()
        return () => {
            active = false
            clearTimeout(timer)
            clearTimeout(refreshTimer)
            controller.abort()
            if (watchersStarted) {
                unwatch(chatKey)
                unwatch(commentsKey)
            }
        }
    }, [scope, commentsToWatch, attempt])

    // Never expose another account/chat's preview during the effect handoff.
    return { ...(preview.scope === scope ? preview : {}), retry: () => setAttempt(value => value + 1) }
}
