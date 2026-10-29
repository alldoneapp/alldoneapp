import { subscribeWithLoading } from '../../utils/redux/loadingOperation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import {
    setAssistantEnabled,
    setNotEnabledAssistantWhenLoadComments,
    setShowNotificationAboutTheBotBehavior,
} from '../../redux/actions'
import store from '../../redux/store'
import { getAssistant } from '../../components/AdminPanel/Assistants/assistantsHelper'
import { watchComments } from '../../utils/backends/Chats/chatsComments'
import { unwatch } from '../../utils/backends/firestore'
import usePendingChatMessages from './usePendingChatMessages'

const toMillis = value => {
    if (!value) return 0
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
        const numericValue = Number(value)
        if (Number.isFinite(numericValue)) return numericValue
        const dateValue = Date.parse(value)
        return Number.isFinite(dateValue) ? dateValue : 0
    }
    if (typeof value.toMillis === 'function') return value.toMillis()
    if (value.seconds !== undefined) {
        const millis = value.seconds * 1000
        const nanos = value.nanoseconds ? Math.floor(value.nanoseconds / 1000000) : 0
        return millis + nanos
    }
    if (typeof value.valueOf === 'function') {
        const numericValue = value.valueOf()
        if (Number.isFinite(numericValue)) return numericValue
    }
    if (typeof value.getTime === 'function') return value.getTime()
    return 0
}

// AT-2922: a message queued behind the current answer is not part of the history yet. It stays
// after everything the thread already holds, including the answer it is waiting for.
const queuedRank = message => (message?.pendingSend?.status === 'queued' ? 1 : 0)

const compareMessages = (a, b) => {
    const rank = queuedRank(a) - queuedRank(b)
    if (rank) return rank
    const aCreated = toMillis(a?.created) || toMillis(a?.lastChangeDate)
    const bCreated = toMillis(b?.created) || toMillis(b?.lastChangeDate)
    return aCreated - bCreated || (a?.id || '').localeCompare(b?.id || '')
}

const useGetMessages = (
    checkAssistant,
    showSpinner,
    projectId,
    objectId,
    chatType,
    toRender = 10000,
    messageCache = null
) => {
    const dispatch = useDispatch()
    const userId = useSelector(state => state.loggedUser?.uid)
    // Firestore retries ordinary network loss itself. Restart a terminated
    // listener on reconnect too, while retaining the assistant's cached rows.
    const connectionState = useSelector(state => (messageCache ? state.connectionState : null))
    const scope = JSON.stringify([userId, projectId, objectId, chatType])
    const cacheScope = { userId, projectId, objectId, chatType, limit: toRender }
    const cached = useMemo(() => messageCache?.read(cacheScope) ?? null, [scope, messageCache, toRender])
    const cachedState = { scope, messages: cached || [], loaded: cached !== null }
    const [state, setState] = useState(cachedState)
    const currentState = state.scope === scope ? state : cachedState
    // The "the assistant spoke last, so keep it on" default belongs to OPENING a chat. The effect
    // below re-subscribes whenever `toRender` grows (loading earlier messages), and re-applying the
    // default then switched the assistant back on right after the user had turned it off (AT-2886).
    const assistantDefaultScopeRef = useRef(null)

    useEffect(() => {
        let isFirstFetch = assistantDefaultScopeRef.current !== scope
        let latestMessages = currentState.messages
        const watcherKey = v4()
        const unsubscribe = subscribeWithLoading(
            'chat_messages',
            (next, onError) => {
                watchComments(projectId, chatType, objectId, watcherKey, toRender, next, { onError })
                return () => unwatch(watcherKey)
            },
            handleSnapshot,
            {
                enabled: showSpinner,
                onError: error => {
                    if (!messageCache) return
                    const denied = ['permission-denied', 'unauthenticated'].some(code => error?.code?.endsWith(code))
                    if (denied) {
                        messageCache.remove(cacheScope)
                        setState({ scope, messages: [], loaded: true })
                    }
                },
            }
        )

        function handleSnapshot(snapshotMessages, metadata) {
            // Keep chronological order strictly based on creation time so edits do not reorder comments
            let sortedMessages = [...snapshotMessages].sort(compareMessages)
            // A partial/empty cache snapshot is not proof of server deletion.
            if (messageCache && metadata?.fromCache && !metadata.hasPendingWrites && latestMessages.length) {
                const merged = new Map(latestMessages.map(message => [message.id, message]))
                sortedMessages.forEach(message => merged.set(message.id, message))
                sortedMessages = [...merged.values()].sort(compareMessages).slice(-toRender)
            }
            latestMessages = sortedMessages
            if (messageCache && !metadata?.fromCache) messageCache.write(cacheScope, sortedMessages)

            if (checkAssistant && isFirstFetch) {
                assistantDefaultScopeRef.current = scope
                const { notEnabledAssistantWhenLoadComments, loggedUser } = store.getState()
                const lastMessage = sortedMessages[sortedMessages.length - 1]
                const assistantResponded =
                    !!lastMessage && (lastMessage.fromAssistant || !!getAssistant(lastMessage.creatorId))
                if (assistantResponded) {
                    if (!loggedUser.noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))

                    if (notEnabledAssistantWhenLoadComments) {
                        dispatch(setNotEnabledAssistantWhenLoadComments(false))
                    } else if (loggedUser.gold > 0) {
                        dispatch(setAssistantEnabled(true))
                    }
                }
            }
            isFirstFetch = false
            setState({ scope, messages: sortedMessages, loaded: true })
        }

        return () => {
            unsubscribe()
            messageCache?.flush()
        }
    }, [toRender, projectId, chatType, objectId, userId, messageCache, connectionState])

    const messagesWithLoaded = usePendingChatMessages(currentState.messages, projectId, objectId, chatType).sort(
        compareMessages
    )
    messagesWithLoaded.loaded = currentState.loaded
    return messagesWithLoaded
}

export default useGetMessages
