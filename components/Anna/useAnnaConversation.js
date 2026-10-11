import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { subscribePageVisible } from '../../utils/appResume'
import { isBrowserOffline } from '../../utils/connectionState'
import {
    clearAnnaConversationCache,
    readAnnaConversationCache,
    saveAnnaConversationCache,
} from './annaConversationCache'

const threadKey = thread => `${thread.projectId}/${thread.chatId || thread.id}`
const threadReference = (reference, created) => ({
    projectId: reference.projectId,
    chatId: reference.chatId || reference.id,
    assistantId: reference.assistantId,
    dateKey: reference.dateKey,
    ...(created == null ? {} : { created }),
})
const mergeThreads = (previous, incoming) => {
    const threads = new Map(previous.map(thread => [threadKey(thread), thread]))
    incoming.forEach(thread => threads.set(threadKey(thread), { ...threads.get(threadKey(thread)), ...thread }))
    return [...threads.values()].sort((a, b) => (a.created || 0) - (b.created || 0))
}
const initialState = (scope, cached) => ({
    scope,
    loading: true,
    conversation: null,
    error: '',
    threads: [],
    nextBefore: null,
    historyLoaded: false,
    ...(cached ? { ...cached, loading: false } : {}),
})
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

export default function useAnnaConversation(userId, { enabled = true, user = {}, hold = false } = {}) {
    const connectionState = useSelector(state => state.connectionState)
    const offline = connectionState === 'offline' || isBrowserOffline()
    const scope = `${userId || ''}/${user.defaultProjectId || ''}`
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const [state, setState] = useState(() => initialState(scope, readAnnaConversationCache(userId, user)))
    const [reference, setReference] = useState(null)
    const activeReference = reference?.scope === scope ? reference : null
    const generation = useRef(0)
    const historyGeneration = useRef(0)
    const flight = useRef(null)
    const historyFlight = useRef(null)
    const nextRollover = useRef(0)
    const holdRef = useRef(hold)
    holdRef.current = hold

    const resolveConversation = useCallback(async () => {
        if (!userId) return null
        if (flight.current) return flight.current
        const currentGeneration = generation.current
        const current = () => currentGeneration === generation.current && scopeRef.current === scope
        const request = runHttpsCallableFunction('getAnnaConversationSecondGen', { includeHistory: false })
            .then(result => {
                if (!current()) return null
                nextRollover.current = result.nextRolloverAt || Date.now() + 30000
                setReference({ ...result, scope })
                setState(previous => ({
                    ...previous,
                    error: '',
                    // The server already validated this chat. Do not wait for a
                    // second network response before mounting its composer.
                    ...(result.conversation ? { conversation: result.conversation, loading: false } : {}),
                    threads: mergeThreads(previous.threads, [
                        threadReference(result, result.conversation?.created),
                        ...(result.threads || []),
                    ]),
                    // Older deployed backends still return history together.
                    historyLoaded: previous.historyLoaded || Array.isArray(result.threads),
                    nextBefore:
                        Array.isArray(result.threads) && !previous.historyLoaded
                            ? result.nextBefore
                            : previous.nextBefore,
                }))
                return { ...result, id: result.chatId }
            })
            .catch(error => {
                if (current()) {
                    const denied = ['permission-denied', 'unauthenticated'].some(code => error.code?.endsWith(code))
                    if (denied) clearAnnaConversationCache(userId, user.defaultProjectId)
                    setState(previous => ({
                        ...previous,
                        loading: false,
                        ...(denied ? { conversation: null, threads: [] } : {}),
                        error:
                            error.code === 'offline'
                                ? ''
                                : error.message || 'Your conversation could not be loaded. Please try again.',
                    }))
                }
                throw error
            })
            .finally(() => {
                if (flight.current === request) flight.current = null
            })
        flight.current = request
        return request
    }, [scope, userId, user.timezone, user.preferredTimezone, user.timezoneOffset, user.timezoneMinutes])

    const loadHistory = useCallback(
        async before => {
            if (!userId) return
            if (historyFlight.current) return historyFlight.current
            const currentGeneration = historyGeneration.current
            const request = runHttpsCallableFunction('getAnnaConversationSecondGen', {
                historyOnly: true,
                ...(before ? { before } : {}),
            })
                .then(result => {
                    if (currentGeneration !== historyGeneration.current || scopeRef.current !== scope) return
                    setState(previous => ({
                        ...previous,
                        // A refreshed first page replaces cached references, including
                        // deleted/inaccessible threads. Pagination still appends.
                        threads: mergeThreads(
                            before
                                ? previous.threads
                                : previous.conversation
                                  ? [threadReference(previous.conversation, previous.conversation.created)]
                                  : [],
                            result.threads || []
                        ),
                        nextBefore: result.nextBefore,
                        historyLoaded: true,
                    }))
                })
                .finally(() => {
                    if (historyFlight.current === request) historyFlight.current = null
                })
            historyFlight.current = request
            return request
        },
        [userId, scope]
    )

    useEffect(() => {
        generation.current++
        historyGeneration.current++
        flight.current = null
        historyFlight.current = null
        nextRollover.current = 0
        const cached = readAnnaConversationCache(userId, user)
        setReference(cached ? { ...threadReference(cached.conversation), scope } : null)
        setState(initialState(scope, cached))
        return () => {
            generation.current++
            historyGeneration.current++
            flight.current = null
            historyFlight.current = null
        }
    }, [scope])

    useEffect(() => {
        if (state.scope === scope && state.conversation) saveAnnaConversationCache(userId, user.defaultProjectId, state)
    }, [scope, state, userId, user.defaultProjectId])

    useEffect(() => {
        generation.current++
        flight.current = null
    }, [resolveConversation])

    // Prefetch only the existing owner-readable pointer and chat, using the
    // normal Firestore cache. Opening Alldone must not create a daily thread.
    useEffect(() => {
        if (!userId || user.isAnonymous || !validId(user.defaultProjectId) || activeReference) return
        let cancelled = false
        const stop = getDb()
            .doc(`users/${userId}/private/annaConversation`)
            .onSnapshot(
                snapshot => {
                    if (cancelled || scopeRef.current !== scope || !snapshot.exists) return
                    const pointer = snapshot.data()
                    const chatId = pointer.chatId || `anna_${userId}`
                    if (
                        pointer.projectId !== user.defaultProjectId ||
                        !validId(pointer.assistantId) ||
                        !validId(userId) ||
                        !(chatId === `anna_${userId}` || new RegExp(`^AnnaChat[0-9]{8}${userId}$`).test(chatId))
                    )
                        return
                    setReference(previous => (previous?.scope === scope ? previous : { ...pointer, chatId, scope }))
                },
                () => {
                    // A missing/offline pointer must not prevent the server fallback.
                    cancelled = true
                }
            )
        return () => {
            cancelled = true
            stop()
        }
    }, [scope, userId, user.defaultProjectId, user.isAnonymous, activeReference])

    useEffect(() => {
        if (!enabled || !userId || offline) return
        resolveConversation().catch(() => {})
        const refresh = () => {
            if (!holdRef.current && !document.hidden && Date.now() >= nextRollover.current)
                resolveConversation().catch(() => {})
        }
        const timer = setInterval(refresh, 30000)
        const stop = subscribePageVisible(refresh)
        return () => {
            clearInterval(timer)
            stop()
        }
    }, [enabled, userId, resolveConversation, offline])

    useEffect(() => {
        if (!activeReference?.chatId) return
        let cancelled = false
        const stop = getDb()
            .doc(`chatObjects/${activeReference.projectId}/chats/${activeReference.chatId}`)
            .onSnapshot(
                { includeMetadataChanges: true },
                snapshot => {
                    if (cancelled || scopeRef.current !== scope) return
                    // A cache miss is unknown, not proof that the conversation was deleted.
                    if (!snapshot.exists && snapshot.metadata?.fromCache) return
                    const chat = snapshot.data()
                    if (
                        !snapshot.exists ||
                        chat?.annaOwnerId !== userId ||
                        chat?.creatorId !== userId ||
                        chat?.type !== 'topics'
                    ) {
                        clearAnnaConversationCache(userId, user.defaultProjectId)
                        setState(previous => ({
                            ...previous,
                            loading: false,
                            conversation: null,
                            threads: [],
                            error: 'Your conversation could not be found.',
                        }))
                        return
                    }
                    const conversation = {
                        ...chat,
                        projectId: activeReference.projectId,
                        id: activeReference.chatId,
                        assistantId: chat.assistantId || activeReference.assistantId,
                    }
                    setState(previous => ({
                        ...previous,
                        loading: false,
                        error: '',
                        conversation,
                        threads: mergeThreads(previous.threads, [threadReference(activeReference, chat.created)]),
                    }))
                },
                error => {
                    if (!cancelled && scopeRef.current === scope) {
                        clearAnnaConversationCache(userId, user.defaultProjectId)
                        setState(previous => ({
                            ...previous,
                            loading: false,
                            conversation: null,
                            threads: [],
                            error: error.message,
                        }))
                    }
                }
            )
        return () => {
            cancelled = true
            stop()
        }
    }, [scope, userId, activeReference?.projectId, activeReference?.chatId, activeReference?.assistantId])

    useEffect(() => {
        if (!enabled || offline || state.scope !== scope || !state.conversation || state.historyLoaded) return
        let cancelled = false
        loadHistory().catch(error => {
            if (!cancelled && scopeRef.current === scope)
                setState(previous => ({
                    ...previous,
                    error:
                        error.code === 'offline' ? '' : error.message || 'Earlier conversations could not be loaded.',
                }))
        })
        return () => {
            cancelled = true
        }
    }, [enabled, offline, scope, state.scope, !!state.conversation, state.historyLoaded, loadHistory])

    return {
        ...(state.scope === scope ? state : initialState(scope)),
        offline,
        loading: !offline && (state.scope === scope ? state.loading : true),
        resolveConversation,
        loadEarlier: () => (state.nextBefore == null ? Promise.resolve() : loadHistory(state.nextBefore)),
        retry: () => Promise.all([resolveConversation(), loadHistory()]).catch(() => {}),
    }
}
